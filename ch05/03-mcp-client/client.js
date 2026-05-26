// 03-mcp-client/client.js
// MCP Client：连接到 MCP Server，列出可用工具，然后调用
// 同时演示如何在 LangChain.js 里使用 MCP 工具
import 'dotenv/config'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0,
})

// ── 方式一：通过 stdio 连接本地 MCP Server ───────────────────
async function connectStdio() {
  console.log('=== 通过 stdio 连接 MCP Server ===\n')

  const transport = new StdioClientTransport({
    command: 'node',
    args: ['../01-mcp-server-basic/server.js'],
  })

  const client = new Client({
    name: 'my-mcp-client',
    version: '1.0.0',
  })

  await client.connect(transport)
  console.log('✓ 连接成功')

  // 列出所有可用工具
  const { tools } = await client.listTools()
  console.log(`\n可用工具（${tools.length} 个）：`)
  tools.forEach(t => console.log(`  - ${t.name}: ${t.description}`))

  // 列出资源
  const { resources } = await client.listResources()
  console.log(`\n可用资源（${resources.length} 个）：`)
  resources.forEach(r => console.log(`  - ${r.name}: ${r.uri}`))

  // 调用工具
  console.log('\n调用 check_code_style 工具：')
  const result = await client.callTool({
    name: 'check_code_style',
    arguments: {
      code: `var x = 1
function hello(name) {
  console.log('Hello ' + name)
}`,
      lang: 'javascript',
    },
  })

  console.log('结果：', result.content[0].text)

  // 读取资源
  console.log('\n读取 Vue3 速查表：')
  const resource = await client.readResource({ uri: 'file:///docs/vue3-cheatsheet' })
  console.log(resource.contents[0].text.slice(0, 200) + '...')

  await client.close()
}

// ── 方式二：通过 HTTP+SSE 连接远程 MCP Server ────────────────
async function connectSSE() {
  console.log('\n=== 通过 SSE 连接远程 MCP Server ===\n')

  const transport = new SSEClientTransport(
    new URL('http://localhost:3001/sse')
  )

  const client = new Client({ name: 'sse-client', version: '1.0.0' })
  await client.connect(transport)
  console.log('✓ SSE 连接成功')

  const { tools } = await client.listTools()
  console.log(`可用工具：`, tools.map(t => t.name).join(', '))

  // 调用 npm 包信息查询
  const npmResult = await client.callTool({
    name: 'get_npm_info',
    arguments: { packageName: 'vue' },
  })
  console.log('\nvue 包信息：', npmResult.content[0].text)

  await client.close()
}

// ── 方式三：把 MCP 工具包装成 LangChain Tool ─────────────────
// 让 AI 模型能直接使用 MCP Server 上的工具
async function mcpWithLangChain() {
  console.log('\n=== MCP 工具 + LangChain 模型 ===\n')

  const transport = new StdioClientTransport({
    command: 'node',
    args: ['../01-mcp-server-basic/server.js'],
  })

  const client = new Client({ name: 'langchain-client', version: '1.0.0' })
  await client.connect(transport)

  // 从 MCP Server 动态获取工具列表，转换成 LangChain 工具格式
  const { tools: mcpTools } = await client.listTools()

  const langchainTools = mcpTools.map(mcpTool => {
    // 把 MCP 的 JSON Schema 转成 Zod Schema（简化版）
    const schemaProps = {}
    if (mcpTool.inputSchema?.properties) {
      for (const [key, prop] of Object.entries(mcpTool.inputSchema.properties)) {
        if (prop.type === 'string') {
          const required = mcpTool.inputSchema.required?.includes(key)
          schemaProps[key] = required
            ? z.string().describe(prop.description || key)
            : z.string().optional().describe(prop.description || key)
        }
        if (prop.type === 'array') {
          schemaProps[key] = z.array(z.string()).optional()
        }
      }
    }

    return tool(
      async (args) => {
        // 通过 MCP 客户端调用工具
        const result = await client.callTool({
          name: mcpTool.name,
          arguments: args,
        })
        return result.content[0]?.text ?? '工具返回为空'
      },
      {
        name: mcpTool.name,
        description: mcpTool.description,
        schema: z.object(schemaProps),
      }
    )
  })

  console.log(`从 MCP Server 加载了 ${langchainTools.length} 个工具`)

  // 让模型使用这些工具
  const modelWithTools = model.bindTools(langchainTools)

  const messages = [
    new SystemMessage('你是前端开发助手，使用工具帮助分析代码。'),
    new HumanMessage(`帮我检查这段代码的风格问题，然后生成一个带 TypeScript 的 Vue3 组件模板：
代码：
var count = 0
function increment() {
  count++
  console.log(count)
}

组件名：CounterButton，需要 props 和 emits`),
  ]

  const firstResponse = await modelWithTools.invoke(messages)
  console.log(`模型调用了 ${firstResponse.tool_calls?.length || 0} 个工具`)

  if (firstResponse.tool_calls?.length) {
    const toolMessages = []
    for (const call of firstResponse.tool_calls) {
      const lcTool = langchainTools.find(t => t.name === call.name)
      const result = await lcTool.invoke(call.args)
      toolMessages.push(new ToolMessage({ content: result, tool_call_id: call.id }))
    }

    const finalResponse = await modelWithTools.invoke([
      ...messages, firstResponse, ...toolMessages,
    ])
    console.log('\nAI 回复：\n', finalResponse.content)
  }

  await client.close()
}

// 运行示例
try {
  await connectStdio()
} catch (e) {
  console.error('stdio 连接失败（需要先确认 server.js 可访问）：', e.message)
}

// 如需测试 SSE，先启动 02-mcp-server-tools/server-http.js
// await connectSSE()
// await mcpWithLangChain()
