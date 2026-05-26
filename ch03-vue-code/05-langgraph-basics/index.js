// 05-langgraph-basics/index.js
// LangGraph 入门：StateGraph、节点、边、状态流转
// LangGraph 的核心是把"对话流程"建模成有向图
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'
import { StateGraph, END, START, Annotation, messagesStateReducer } from '@langchain/langgraph'
import { StringOutputParser } from '@langchain/core/output_parsers'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0.7,
})

// ── 1. 最简单的 LangGraph：单节点 ───────────────────────────
async function simpleGraph() {
  console.log('\n=== 1. 最简单的 Graph（单节点）===')

  // 定义状态结构
  const GraphState = Annotation.Root({
    messages: Annotation({
      reducer: messagesStateReducer, // 内置 reducer：新消息追加到数组
      default: () => [],
    }),
  })

  // 定义节点函数：接收 state，返回 state 的更新
  async function chatNode(state) {
    const res = await model.invoke([
      new SystemMessage('你是前端助手'),
      ...state.messages,
    ])
    return { messages: [res] } // 返回新增的消息
  }

  // 构建图
  const graph = new StateGraph(GraphState)
    .addNode('chat', chatNode)      // 添加节点
    .addEdge(START, 'chat')         // 开始 → chat
    .addEdge('chat', END)           // chat → 结束
    .compile()

  const result = await graph.invoke({
    messages: [new HumanMessage('Vue3 的 defineExpose 有什么用？')],
  })

  const lastMsg = result.messages[result.messages.length - 1]
  console.log('回复：', lastMsg.content.slice(0, 150))
}

// ── 2. 多节点顺序图 ──────────────────────────────────────────
async function sequentialGraph() {
  console.log('\n=== 2. 多节点顺序图 ===')

  const State = Annotation.Root({
    userInput: Annotation({ reducer: (_, n) => n, default: () => '' }),
    analysis: Annotation({ reducer: (_, n) => n, default: () => '' }),
    solution: Annotation({ reducer: (_, n) => n, default: () => '' }),
    codeExample: Annotation({ reducer: (_, n) => n, default: () => '' }),
  })

  // 节点1：分析问题类型
  async function analyzeNode(state) {
    const res = await model.invoke([
      new SystemMessage('你是代码分析师，判断问题类型（性能/逻辑/语法/架构），输出一句话。'),
      new HumanMessage(`分析这个问题：${state.userInput}`),
    ])
    return { analysis: res.content }
  }

  // 节点2：给出解决方案
  async function solutionNode(state) {
    const res = await model.invoke([
      new SystemMessage('你是前端专家，给出简洁的解决思路，不超过 3 步。'),
      new HumanMessage(`问题：${state.userInput}\n问题类型：${state.analysis}\n给出解决方案：`),
    ])
    return { solution: res.content }
  }

  // 节点3：生成代码示例
  async function codeNode(state) {
    const res = await model.invoke([
      new SystemMessage('你是前端工程师，根据解决方案写一小段代码示例（15行以内）。'),
      new HumanMessage(`解决方案：${state.solution}\n写代码示例：`),
    ])
    return { codeExample: res.content }
  }

  const graph = new StateGraph(State)
    .addNode('analyze', analyzeNode)
    .addNode('solution', solutionNode)
    .addNode('code', codeNode)
    .addEdge(START, 'analyze')
    .addEdge('analyze', 'solution')
    .addEdge('solution', 'code')
    .addEdge('code', END)
    .compile()

  const result = await graph.invoke({
    userInput: 'Vue3 列表渲染 1000 条数据时页面卡顿',
  })

  console.log('问题分析：', result.analysis)
  console.log('解决方案：', result.solution.slice(0, 150))
  console.log('代码示例：', result.codeExample.slice(0, 200))
}

// ── 3. 状态更新规则 ──────────────────────────────────────────
async function stateUpdate() {
  console.log('\n=== 3. 状态更新规则演示 ===')

  const State = Annotation.Root({
    // 替换型：每次更新都用新值覆盖
    currentStep: Annotation({ reducer: (_, n) => n, default: () => '' }),
    // 累加型：新值追加到数组
    steps: Annotation({
      reducer: (existing, newVal) => [...existing, ...newVal],
      default: () => [],
    }),
    // messages 使用内置 reducer
    messages: Annotation({ reducer: messagesStateReducer, default: () => [] }),
  })

  async function step1(state) {
    return {
      currentStep: 'step1',
      steps: ['step1: 初始化'],
    }
  }

  async function step2(state) {
    return {
      currentStep: 'step2',
      steps: ['step2: 处理中'],
    }
  }

  async function step3(state) {
    return {
      currentStep: 'step3',
      steps: ['step3: 完成'],
    }
  }

  const graph = new StateGraph(State)
    .addNode('s1', step1)
    .addNode('s2', step2)
    .addNode('s3', step3)
    .addEdge(START, 's1')
    .addEdge('s1', 's2')
    .addEdge('s2', 's3')
    .addEdge('s3', END)
    .compile()

  const result = await graph.invoke({})
  console.log('currentStep（替换）：', result.currentStep)
  console.log('steps（累加）：', result.steps)
}

await simpleGraph()
await sequentialGraph()
await stateUpdate()
