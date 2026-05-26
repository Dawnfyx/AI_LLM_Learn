// 04-mcp-with-express/index.js
// 在 Express AI 应用里集成 MCP：启动时连接多个 MCP Server，动态加载工具
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { ChatOpenAI } from '@langchain/openai'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import { StateGraph, END, START, Annotation, messagesStateReducer } from '@langchain/langgraph'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'

const app = express()
app.use(cors())
app.use(express.json())

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0,
  streaming: true,
})

// ── MCP 连接管理 ──────────────────────────────────────────────
class McpManager {
  constructor() {
    this.clients = new Map()   // serverName → client
    this.allTools = []         // 所有 MCP Server 的工具（LangChain 格式）
  }

  // 连接一个 MCP Server（stdio 方式）
  async connectStdio(name, command, args) {
    const transport = new StdioClientTransport({ command, args })
    const client = new Client({ name: `host-${name}`, version: '1.0.0' })
    await client.connect(transport)
    this.clients.set(name, client)
    console.log(`✓ MCP Server "${name}" 连接成功`)
    return client
  }

  // 连接一个 MCP Server（SSE 方式）
  async connectSSE(name, url) {
    const transport = new SSEClientTransport(new URL(url))
    const client = new Client({ name: `host-${name}`, version: '1.0.0' })
    await client.connect(transport)
    this.clients.set(name, client)
    console.log(`✓ MCP Server "${name}" (SSE) 连接成功`)
    return client
  }

  // 从所有已连接的 Server 加载工具，转成 LangChain 格式
  async loadAllTools() {
    this.allTools = []

    for (const [serverName, client] of this.clients) {
      const { tools } = await client.listTools()

      for (const mcpTool of tools) {
        // 把 MCP JSON Schema 转成 Zod（简化版，生产中用 json-schema-to-zod 库）
        const schema = buildZodSchema(mcpTool.inputSchema)

        const lcTool = tool(
          async (args) => {
            try {
              const result = await client.callTool({
                name: mcpTool.name,
                arguments: args,
              })
              return result.content.map(c => c.text || '').join('\n')
            } catch (err) {
              return JSON.stringify({ error: err.message })
            }
          },
          {
            name: `${serverName}_${mcpTool.name}`, // 加前缀防止命名冲突
            description: `[${serverName}] ${mcpTool.description}`,
            schema,
          }
        )

        this.allTools.push(lcTool)
      }

      console.log(`  从 "${serverName}" 加载了 ${tools.length} 个工具`)
    }

    console.log(`\n共加载 ${this.allTools.length} 个工具`)
    return this.allTools
  }

  async disconnect() {
    for (const [name, client] of this.clients) {
      await client.close()
      console.log(`断开 MCP Server "${name}"`)
    }
  }
}

// 简化版：把 JSON Schema 转成 Zod Schema
function buildZodSchema(jsonSchema) {
  if (!jsonSchema?.properties) return z.object({})

  const props = {}
  const required = new Set(jsonSchema.required || [])

  for (const [key, prop] of Object.entries(jsonSchema.properties)) {
    let zodType

    if (prop.type === 'string') {
      zodType = z.string()
      if (prop.enum) zodType = z.enum(prop.enum)
    } else if (prop.type === 'number') {
      zodType = z.number()
    } else if (prop.type === 'boolean') {
      zodType = z.boolean()
    } else if (prop.type === 'array') {
      zodType = z.array(z.string())
    } else {
      zodType = z.any()
    }

    if (prop.description) zodType = zodType.describe(prop.description)
    if (!required.has(key)) zodType = zodType.optional()

    props[key] = zodType
  }

  return z.object(props)
}

// ── 初始化 ────────────────────────────────────────────────────
const mcpManager = new McpManager()
let chatGraph = null

async function bootstrap() {
  console.log('\n初始化 MCP 连接...')

  // 连接本地 MCP Server（stdio）
  try {
    await mcpManager.connectStdio(
      'frontend-tools',
      'node',
      ['../01-mcp-server-basic/server.js']
    )
  } catch (e) {
    console.warn('stdio Server 连接失败，跳过：', e.message)
  }

  // 连接远程 MCP Server（SSE）
  try {
    await mcpManager.connectSSE(
      'dev-tools',
      'http://localhost:3001/sse'
    )
  } catch (e) {
    console.warn('SSE Server 连接失败，跳过：', e.message)
  }

  // 加载所有工具
  const tools = await mcpManager.loadAllTools()

  // 如果没有连接到任何 Server，用内置的基础工具
  if (tools.length === 0) {
    console.log('未连接到 MCP Server，使用内置工具')
    tools.push(
      tool(
        async ({ query }) => `搜索"${query}"的结果（内置模拟数据）`,
        {
          name: 'builtin_search',
          description: '基础搜索工具',
          schema: z.object({ query: z.string() }),
        }
      )
    )
  }

  // 构建 LangGraph
  const toolNode = new ToolNode(tools)
  const State = Annotation.Root({
    messages: Annotation({ reducer: messagesStateReducer, default: () => [] }),
  })

  async function agentNode(state) {
    const response = await model.bindTools(tools).invoke([
      new SystemMessage(`你是前端开发助手，可以使用以下工具：
${tools.map(t => `- ${t.name}: ${t.description}`).join('\n')}`),
      ...state.messages,
    ])
    return { messages: [response] }
  }

  function route(state) {
    const last = state.messages[state.messages.length - 1]
    return last.tool_calls?.length ? 'tools' : '__end__'
  }

  chatGraph = new StateGraph(State)
    .addNode('agent', agentNode)
    .addNode('tools', toolNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', route, { tools: 'tools', __end__: END })
    .addEdge('tools', 'agent')
    .compile()
}

// ── API 路由 ──────────────────────────────────────────────────
app.get('/api/tools', (req, res) => {
  res.json({
    tools: mcpManager.allTools.map(t => ({
      name: t.name,
      description: t.description,
    })),
  })
})

app.post('/api/chat/stream', async (req, res) => {
  if (!chatGraph) return res.status(503).json({ error: '服务初始化中' })

  const { message } = req.body
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const send = (event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  try {
    for await (const event of chatGraph.streamEvents(
      { messages: [new HumanMessage(message)] },
      { version: 'v2' }
    )) {
      if (event.event === 'on_tool_start') {
        send('tool_start', { toolName: event.name, args: event.data?.input })
      }
      if (event.event === 'on_tool_end') {
        send('tool_end', { toolName: event.name, result: event.data?.output })
      }
      if (event.event === 'on_chat_model_stream' && event.data?.chunk?.content) {
        send('token', { token: event.data.chunk.content })
      }
    }
    send('done', {})
  } catch (err) {
    send('error', { message: err.message })
  } finally {
    res.end()
  }
})

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    mcpServers: [...mcpManager.clients.keys()],
    totalTools: mcpManager.allTools.length,
  })
})

// 优雅退出
process.on('SIGINT', async () => {
  await mcpManager.disconnect()
  process.exit(0)
})

await bootstrap()

app.listen(3000, () => {
  console.log('\n服务已启动：http://localhost:3000')
})
