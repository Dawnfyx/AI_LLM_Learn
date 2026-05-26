// 02-agent-with-memory/index.js
// Agent + 记忆 + 自我反思
// 自我反思（Reflection）：任务完成后，Agent 评估自己的回答质量，必要时重新尝试
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { tool } from '@langchain/core/tools'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import { StateGraph, END, START, Annotation, messagesStateReducer } from '@langchain/langgraph'
import { HumanMessage, AIMessage, SystemMessage, HumanMessage as HM } from '@langchain/core/messages'
import { InMemoryChatMessageHistory } from '@langchain/core/chat_history'
import { z } from 'zod'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0,
})

// ── 工具 ──────────────────────────────────────────────────────
const calcTool = tool(
  async ({ expression }) => {
    try {
      // 只允许数学表达式（生产中用专门的 math 库）
      const safe = expression.replace(/[^0-9+\-*/().,\s]/g, '')
      const result = Function(`"use strict"; return (${safe})`)()
      return JSON.stringify({ expression, result, type: typeof result })
    } catch (e) {
      return JSON.stringify({ error: `无法计算：${e.message}` })
    }
  },
  {
    name: 'calculate',
    description: '计算数学表达式，支持 +、-、*、/、()、小数',
    schema: z.object({ expression: z.string().describe('数学表达式，如 (100 + 200) * 0.15') }),
  }
)

const lookupTool = tool(
  async ({ concept }) => {
    const kb = {
      'Tree Shaking': '构建工具在打包时自动移除未使用的代码，减小产物体积。依赖 ES Module 的静态分析。Vite 和 Rollup 默认支持。',
      'Code Splitting': '将代码分割成多个 chunk，按需加载。Vue Router 的路由懒加载、动态 import() 都属于代码分割。',
      'SSR': '服务端渲染，在服务器上执行组件渲染，返回 HTML 字符串，提升首屏速度和 SEO。',
      'Hydration': 'SSR 后，客户端 JS 接管已有的 DOM，绑定事件和响应式，这个过程叫水合（Hydration）。',
    }
    return kb[concept] ?? `"${concept}" 暂无相关记录`
  },
  {
    name: 'lookup',
    description: '查询前端术语定义',
    schema: z.object({ concept: z.string().describe('要查询的术语') }),
  }
)

const tools = [calcTool, lookupTool]
const toolNode = new ToolNode(tools)

// ── 带反思的 Agent 状态 ───────────────────────────────────────
const State = Annotation.Root({
  messages:       Annotation({ reducer: messagesStateReducer, default: () => [] }),
  steps:          Annotation({ reducer: (_, n) => n, default: () => 0 }),
  reflections:    Annotation({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  finalAnswer:    Annotation({ reducer: (_, n) => n, default: () => '' }),
  satisfactory:   Annotation({ reducer: (_, n) => n, default: () => false }),
  retryCount:     Annotation({ reducer: (_, n) => n, default: () => 0 }),
})

// 节点1：Agent 主推理
async function agentNode(state) {
  const response = await model.bindTools(tools).invoke([
    new SystemMessage('你是前端技术助手，使用工具完成任务后，给出清晰完整的回答。'),
    ...state.messages,
  ])
  return { messages: [response], steps: state.steps + 1 }
}

// 节点2：自我反思——评估回答质量
async function reflectNode(state) {
  const lastAnswer = state.messages
    .filter(m => m._getType() === 'ai')
    .slice(-1)[0]?.content ?? ''

  const originalQuestion = state.messages
    .filter(m => m._getType() === 'human')
    .slice(0, 1)[0]?.content ?? ''

  const reflectModel = model.withStructuredOutput(z.object({
    satisfactory: z.boolean().describe('回答是否完整、准确、满足用户需求'),
    issues: z.array(z.string()).describe('不满意的原因（satisfactory 为 false 时填写）'),
    suggestion: z.string().describe('改进建议'),
  }))

  const reflection = await reflectModel.invoke([
    new SystemMessage('你是质量审核员，评估 AI 助手的回答质量。'),
    new HumanMessage(`原始问题：${originalQuestion}\n\nAI 回答：${lastAnswer}\n\n评估这个回答是否完整、准确。`),
  ])

  console.log(`  [反思] 满意：${reflection.satisfactory}${reflection.issues.length ? `，问题：${reflection.issues.join(', ')}` : ''}`)

  return {
    reflections: [reflection],
    satisfactory: reflection.satisfactory,
    finalAnswer: reflection.satisfactory ? lastAnswer : '',
    retryCount: state.retryCount + (reflection.satisfactory ? 0 : 1),
  }
}

// 节点3：根据反思结果重新生成
async function reviseNode(state) {
  const lastReflection = state.reflections[state.reflections.length - 1]

  const reviseResponse = await model.bindTools(tools).invoke([
    new SystemMessage('你是前端技术助手，根据改进意见重新回答。'),
    ...state.messages,
    new HumanMessage(`你的上一个回答存在问题：${lastReflection.issues.join('；')}\n\n改进建议：${lastReflection.suggestion}\n\n请改进后重新回答。`),
  ])

  return { messages: [reviseResponse], steps: state.steps + 1 }
}

// 路由函数
function routeAfterAgent(state) {
  const last = state.messages[state.messages.length - 1]
  if (last.tool_calls?.length && state.steps < 8) return 'tools'
  return 'reflect'  // 没有工具调用，进入反思
}

function routeAfterReflect(state) {
  if (state.satisfactory) return 'end'
  if (state.retryCount >= 2) return 'end'   // 最多重试2次
  return 'revise'
}

const agentWithReflect = new StateGraph(State)
  .addNode('agent',   agentNode)
  .addNode('tools',   toolNode)
  .addNode('reflect', reflectNode)
  .addNode('revise',  reviseNode)
  .addEdge(START, 'agent')
  .addConditionalEdges('agent', routeAfterAgent, { tools: 'tools', reflect: 'reflect' })
  .addEdge('tools', 'agent')
  .addConditionalEdges('reflect', routeAfterReflect, { end: END, revise: 'revise' })
  .addEdge('revise', 'reflect')
  .compile()

// ── 带持久化记忆的多轮 Agent ──────────────────────────────────
const sessionHistory = new InMemoryChatMessageHistory()

async function chatWithMemory(userInput) {
  const history = await sessionHistory.getMessages()

  const result = await agentWithReflect.invoke({
    messages: [...history, new HumanMessage(userInput)],
    steps: 0, reflections: [], finalAnswer: '', satisfactory: false, retryCount: 0,
  })

  const lastAI = result.messages.filter(m => m._getType() === 'ai').slice(-1)[0]

  // 保存本轮到历史
  await sessionHistory.addMessage(new HumanMessage(userInput))
  await sessionHistory.addMessage(new AIMessage(lastAI.content))

  return lastAI.content
}

// 测试
console.log('=== Agent + 反思 + 记忆 ===\n')

const r1 = await chatWithMemory('Tree Shaking 和 Code Splitting 有什么区别？')
console.log('Q1 回答：', r1.slice(0, 200), '\n')

const r2 = await chatWithMemory('我刚才问的两个概念，哪个更适合用于减少首屏加载时间？')
console.log('Q2 回答（依赖上文）：', r2.slice(0, 200))
