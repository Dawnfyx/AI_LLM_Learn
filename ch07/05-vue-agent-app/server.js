// 05-vue-agent-app/server.js
// Agent 应用服务端：流式推送思考步骤 + 工具调用 + 最终回答
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { ChatOpenAI } from '@langchain/openai'
import { tool } from '@langchain/core/tools'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import { StateGraph, END, START, Annotation, messagesStateReducer } from '@langchain/langgraph'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
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

// ── 前端开发 Agent 工具集 ─────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

const searchDocsTool = tool(
  async ({ query }) => {
    await sleep(300)
    const docs = {
      'Vue3 v-model': 'v-model 是 :modelValue + @update:modelValue 的语法糖。Vue3.4+ 推荐用 defineModel() 宏简化写法。',
      'React useEffect': 'useEffect(fn, deps) 副作用钩子。deps 为 [] 只运行一次；deps 有值时，依赖变化才重新运行；不传 deps 每次渲染都运行。',
      'CSS Flexbox': 'display:flex 启用弹性布局。justify-content 控制主轴对齐，align-items 控制交叉轴对齐。flex:1 让元素占满剩余空间。',
      'TypeScript 泛型': '泛型用 <T> 表示类型参数，让函数和组件支持多种类型而保持类型安全。例：function identity<T>(arg: T): T { return arg }',
    }
    const key = Object.keys(docs).find(k => query.toLowerCase().includes(k.toLowerCase().split(' ')[0]))
    return key ? docs[key] : `关于"${query}"：暂无文档，建议查阅 MDN 或官方文档。`
  },
  {
    name: 'search_docs',
    description: '搜索前端技术文档，查找 Vue3、React、CSS、TypeScript 等技术的用法和最佳实践',
    schema: z.object({ query: z.string().describe('搜索关键词') }),
  }
)

const analyzeCodeTool = tool(
  async ({ code }) => {
    await sleep(400)
    const issues = []
    if (code.includes('var ')) issues.push({ type: 'style', msg: '使用 let/const 替代 var' })
    if (code.includes('any')) issues.push({ type: 'type', msg: '避免使用 any 类型' })
    if (code.includes('console.log')) issues.push({ type: 'debug', msg: '移除调试用的 console.log' })
    if (!code.includes('try') && (code.includes('await') || code.includes('.then'))) {
      issues.push({ type: 'error', msg: '异步操作缺少错误处理（try/catch 或 .catch）' })
    }

    return JSON.stringify({
      issueCount: issues.length,
      issues,
      overall: issues.length === 0 ? '✓ 代码质量良好' : `发现 ${issues.length} 个问题`,
    })
  },
  {
    name: 'analyze_code',
    description: '分析代码质量，检查潜在问题：类型错误、风格问题、安全隐患',
    schema: z.object({ code: z.string().describe('要分析的代码片段') }),
  }
)

const generateSnippetTool = tool(
  async ({ type, framework, description }) => {
    await sleep(350)
    const templates = {
      'composable-vue3': `// use${description.replace(/\s/g, '')}
import { ref, onMounted, onUnmounted } from 'vue'

export function use${description.replace(/\s/g, '')}() {
  const data = ref(null)
  const loading = ref(false)
  const error = ref(null)

  async function fetch() {
    loading.value = true
    try {
      // TODO: 实现具体逻辑
    } catch (e) {
      error.value = e.message
    } finally {
      loading.value = false
    }
  }

  onMounted(fetch)

  return { data, loading, error, refetch: fetch }
}`,
      'hook-react': `// use${description.replace(/\s/g, '')}
import { useState, useEffect } from 'react'

export function use${description.replace(/\s/g, '')}() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    setLoading(true)
    // TODO: 实现具体逻辑
    setLoading(false)
  }, [])

  return { data, loading, error }
}`,
    }
    const key = `${type}-${framework}`
    return templates[key] || `// ${description} 代码片段（${framework}）\n// TODO: 根据需求实现`
  },
  {
    name: 'generate_snippet',
    description: '生成常用代码片段：Vue3 Composable、React Hook、工具函数等',
    schema: z.object({
      type: z.enum(['composable', 'hook', 'utility', 'component']),
      framework: z.enum(['vue3', 'react']),
      description: z.string().describe('功能描述，如：数据获取、防抖、本地存储'),
    }),
  }
)

const tools = [searchDocsTool, analyzeCodeTool, generateSnippetTool]
const toolNode = new ToolNode(tools)

// ── LangGraph Agent ───────────────────────────────────────────
const State = Annotation.Root({
  messages: Annotation({ reducer: messagesStateReducer, default: () => [] }),
  steps: Annotation({ reducer: (_, n) => n, default: () => 0 }),
})

async function agentNode(state) {
  const response = await model.bindTools(tools).invoke([
    new SystemMessage(`你是资深前端开发助手，拥有以下能力：
- 搜索技术文档（search_docs）
- 分析代码质量（analyze_code）
- 生成代码片段（generate_snippet）

工作策略：
1. 先理解用户需求
2. 按需调用工具获取信息或生成代码
3. 综合结果给出完整、实用的回答
4. 代码示例要有注释`),
    ...state.messages,
  ])
  return { messages: [response], steps: state.steps + 1 }
}

const agentGraph = new StateGraph(State)
  .addNode('agent', agentNode)
  .addNode('tools', toolNode)
  .addEdge(START, 'agent')
  .addConditionalEdges('agent',
    s => (s.messages[s.messages.length-1].tool_calls?.length && s.steps < 8) ? 'tools' : '__end__',
    { tools: 'tools', __end__: END }
  )
  .addEdge('tools', 'agent')
  .compile()

// ── API：流式执行 Agent ───────────────────────────────────────
app.post('/api/agent/stream', async (req, res) => {
  const { message } = req.body
  if (!message?.trim()) return res.status(400).json({ error: '消息不能为空' })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const send = (event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  try {
    send('start', { message })

    for await (const event of agentGraph.streamEvents(
      { messages: [new HumanMessage(message)], steps: 0 },
      { version: 'v2' }
    )) {
      // 工具调用开始
      if (event.event === 'on_tool_start') {
        send('tool_start', { name: event.name, args: event.data?.input })
      }
      // 工具调用结束
      if (event.event === 'on_tool_end') {
        send('tool_end', { name: event.name, result: event.data?.output })
      }
      // 模型 token 输出
      if (event.event === 'on_chat_model_stream' && event.data?.chunk?.content) {
        send('token', { token: event.data.chunk.content })
      }
    }

    send('done', {})
  } catch (e) {
    send('error', { message: e.message })
  } finally {
    res.end()
  }
})

app.get('/health', (req, res) => res.json({ status: 'ok', tools: tools.map(t => t.name) }))

app.listen(3000, () => console.log('Agent 服务已启动：http://localhost:3000'))
