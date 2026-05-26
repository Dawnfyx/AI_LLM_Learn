// 06-vue-tool-dashboard/server.js
// 后端：带工具调用状态推送的 SSE 接口
// 前端可以实时看到"正在调用哪个工具"的过程
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { StateGraph, END, START, Annotation, messagesStateReducer } from '@langchain/langgraph'
import { ToolNode } from '@langchain/langgraph/prebuilt'

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

// ── 工具定义 ──────────────────────────────────────────────────
const tools = [
  tool(
    async ({ city }) => {
      await new Promise(r => setTimeout(r, 500))
      const data = { '北京': '晴，18°C', '上海': '多云，23°C', '广州': '雨，28°C' }
      return JSON.stringify({ city, weather: data[city] || '数据不可用', time: new Date().toLocaleTimeString() })
    },
    {
      name: 'get_weather',
      description: '查询城市天气',
      schema: z.object({ city: z.string() }),
    }
  ),
  tool(
    async ({ packageName }) => {
      await new Promise(r => setTimeout(r, 400))
      const db = { vue: '3.4.27', react: '18.3.1', vite: '5.4.2', pinia: '2.2.2' }
      return JSON.stringify({ package: packageName, version: db[packageName] || '未知', registry: 'npmjs.com' })
    },
    {
      name: 'get_npm_version',
      description: '查询 npm 包最新版本',
      schema: z.object({ packageName: z.string() }),
    }
  ),
  tool(
    async ({ a, b, op }) => {
      const ops = { '+': a + b, '-': a - b, '*': a * b, '/': b !== 0 ? a / b : null }
      return JSON.stringify({ expression: `${a} ${op} ${b}`, result: ops[op] })
    },
    {
      name: 'calculate',
      description: '数学运算',
      schema: z.object({ a: z.number(), b: z.number(), op: z.enum(['+', '-', '*', '/']) }),
    }
  ),
]

const modelWithTools = model.bindTools(tools)
const toolNode = new ToolNode(tools)

const AgentState = Annotation.Root({
  messages: Annotation({ reducer: messagesStateReducer, default: () => [] }),
})

async function agentNode(state) {
  const res = await modelWithTools.invoke([
    new SystemMessage('你是助手，需要查询信息时使用工具。'),
    ...state.messages,
  ])
  return { messages: [res] }
}

const graph = new StateGraph(AgentState)
  .addNode('agent', agentNode)
  .addNode('tools', toolNode)
  .addEdge(START, 'agent')
  .addConditionalEdges('agent',
    state => state.messages[state.messages.length - 1].tool_calls?.length ? 'tools' : '__end__',
    { tools: 'tools', __end__: END }
  )
  .addEdge('tools', 'agent')
  .compile()

// ── SSE 接口：实时推送工具调用状态 ────────────────────────────
app.post('/api/chat/stream', async (req, res) => {
  const { message } = req.body

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const send = (event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  send('start', { message })

  try {
    let fullReply = ''

    for await (const event of graph.streamEvents(
      { messages: [new HumanMessage(message)] },
      { version: 'v2' }
    )) {
      // 工具调用开始
      if (event.event === 'on_tool_start') {
        send('tool_start', {
          tool: event.name,
          args: event.data?.input,
          timestamp: Date.now(),
        })
      }

      // 工具调用结束
      if (event.event === 'on_tool_end') {
        send('tool_end', {
          tool: event.name,
          result: event.data?.output,
          timestamp: Date.now(),
        })
      }

      // 模型流式 token
      if (
        event.event === 'on_chat_model_stream' &&
        event.data?.chunk?.content
      ) {
        fullReply += event.data.chunk.content
        send('token', { token: event.data.chunk.content })
      }
    }

    send('done', { fullReply })
  } catch (err) {
    send('error', { message: err.message })
  } finally {
    res.end()
  }
})

app.get('/health', (_, res) => res.json({ ok: true }))

app.listen(3000, () => console.log('Server: http://localhost:3000'))
