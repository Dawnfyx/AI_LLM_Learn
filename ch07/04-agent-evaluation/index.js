// 04-agent-evaluation/index.js
// Agent 评估：测量 Agent 的准确率、工具使用效率、任务完成率
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { tool } from '@langchain/core/tools'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import { StateGraph, END, START, Annotation, messagesStateReducer } from '@langchain/langgraph'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { z } from 'zod'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0,
})

// ── 简单工具 ──────────────────────────────────────────────────
const mathTool = tool(
  async ({ expr }) => {
    try {
      const safe = expr.replace(/[^0-9+\-*/().,\s]/g, '')
      return String(Function(`"use strict"; return (${safe})`)())
    } catch { return 'ERROR' }
  },
  { name: 'math', description: '计算数学表达式', schema: z.object({ expr: z.string() }) }
)

const lookupTool = tool(
  async ({ term }) => {
    const db = {
      'flexbox': 'CSS 弹性布局，使用 display:flex 启用，主轴/交叉轴布局',
      'grid': 'CSS 网格布局，使用 display:grid 启用，二维布局系统',
      'var': 'CSS 自定义属性（CSS变量），--变量名定义，var(--变量名)引用',
    }
    return db[term.toLowerCase()] ?? `未找到 ${term}`
  },
  { name: 'lookup', description: '查询 CSS 术语', schema: z.object({ term: z.string() }) }
)

const tools = [mathTool, lookupTool]
const toolNode = new ToolNode(tools)

// 构建被测 Agent
const State = Annotation.Root({
  messages: Annotation({ reducer: messagesStateReducer, default: () => [] }),
  steps: Annotation({ reducer: (_, n) => n, default: () => 0 }),
})

async function agentNode(state) {
  const res = await model.bindTools(tools).invoke([
    new SystemMessage('你是前端助手，使用工具回答问题。'),
    ...state.messages,
  ])
  return { messages: [res], steps: state.steps + 1 }
}

const testAgent = new StateGraph(State)
  .addNode('agent', agentNode)
  .addNode('tools', toolNode)
  .addEdge(START, 'agent')
  .addConditionalEdges('agent',
    s => (s.messages[s.messages.length-1].tool_calls?.length && s.steps < 5) ? 'tools' : '__end__',
    { tools: 'tools', __end__: END }
  )
  .addEdge('tools', 'agent')
  .compile()

// ── 评估数据集 ────────────────────────────────────────────────
const evalDataset = [
  {
    id: 'math-1',
    input: '计算 15% 的 1200 是多少',
    expectedToolCalls: ['math'],
    expectedAnswer: '180',
    category: 'calculation',
  },
  {
    id: 'lookup-1',
    input: 'flexbox 是什么？',
    expectedToolCalls: ['lookup'],
    expectedAnswer: 'flex',  // 答案应包含这个关键词
    category: 'knowledge',
  },
  {
    id: 'multi-1',
    input: '用 CSS grid 布局，把宽度 1200px 的容器分成3列，每列宽多少？',
    expectedToolCalls: ['lookup', 'math'],
    expectedAnswer: '400',
    category: 'complex',
  },
  {
    id: 'no-tool',
    input: '你好',
    expectedToolCalls: [],
    expectedAnswer: '好',
    category: 'simple',
  },
]

// ── 评估函数 ──────────────────────────────────────────────────
async function evaluateAgent(dataset) {
  const results = []

  for (const testCase of dataset) {
    const startTime = Date.now()

    const result = await testAgent.invoke({
      messages: [new HumanMessage(testCase.input)],
      steps: 0,
    })

    const duration = Date.now() - startTime
    const lastMsg  = result.messages[result.messages.length - 1]
    const answer   = lastMsg.content

    // 收集实际调用的工具
    const actualToolCalls = result.messages
      .filter(m => m._getType() === 'tool')
      .map(m => m.name)

    // 评分
    const answerCorrect   = answer.toLowerCase().includes(testCase.expectedAnswer.toLowerCase())
    const toolsCorrect    = testCase.expectedToolCalls.every(t => actualToolCalls.includes(t))
    const noExtraTools    = actualToolCalls.length <= testCase.expectedToolCalls.length + 1
    const score = (answerCorrect ? 50 : 0) + (toolsCorrect ? 30 : 0) + (noExtraTools ? 20 : 0)

    results.push({
      id: testCase.id,
      category: testCase.category,
      input: testCase.input,
      answer: answer.slice(0, 80),
      expectedTools: testCase.expectedToolCalls,
      actualTools: actualToolCalls,
      answerCorrect,
      toolsCorrect,
      score,
      duration,
      steps: result.steps,
    })

    console.log(`[${testCase.id}] 分数: ${score}/100, 耗时: ${duration}ms, 步数: ${result.steps}`)
  }

  // 汇总统计
  const total     = results.length
  const avgScore  = results.reduce((s, r) => s + r.score, 0) / total
  const avgTime   = results.reduce((s, r) => s + r.duration, 0) / total
  const passCount = results.filter(r => r.score >= 80).length

  // 按类别统计
  const byCategory = {}
  for (const r of results) {
    if (!byCategory[r.category]) byCategory[r.category] = []
    byCategory[r.category].push(r.score)
  }

  console.log('\n=== 评估报告 ===')
  console.log(`测试用例: ${total}`)
  console.log(`通过率(≥80分): ${((passCount / total) * 100).toFixed(1)}%`)
  console.log(`平均分: ${avgScore.toFixed(1)}/100`)
  console.log(`平均响应时间: ${avgTime.toFixed(0)}ms`)
  console.log(`\n各类别平均分:`)
  for (const [cat, scores] of Object.entries(byCategory)) {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length
    console.log(`  ${cat}: ${avg.toFixed(1)}`)
  }

  return { results, avgScore, passCount, total }
}

await evaluateAgent(evalDataset)
