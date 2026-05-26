// 06-langgraph-conditional/index.js
// LangGraph 条件路由：根据状态动态决定走哪条边
// 这是 LangGraph 最核心的能力——让 AI 自己决定流程走向
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'
import { StateGraph, END, START, Annotation, messagesStateReducer } from '@langchain/langgraph'
import { z } from 'zod'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0,
})

// ── 场景：智能问题分流系统 ───────────────────────────────────
// 用户提问 → AI 判断类型 → 路由到对应的处理节点
//
//                    ┌─── code_help (代码问题)
//  classify ─────────┼─── concept  (概念解释)
//                    └─── resource (推荐资料)

const State = Annotation.Root({
  messages: Annotation({ reducer: messagesStateReducer, default: () => [] }),
  questionType: Annotation({ reducer: (_, n) => n, default: () => '' }),
  answer: Annotation({ reducer: (_, n) => n, default: () => '' }),
})

// 节点1：意图分类
const ClassifySchema = z.object({
  type: z.enum(['code_help', 'concept', 'resource']),
  reason: z.string(),
})

async function classifyNode(state) {
  const lastMsg = state.messages[state.messages.length - 1]
  const question = lastMsg.content

  const classifyModel = model.withStructuredOutput(ClassifySchema)

  const result = await classifyModel.invoke([
    new SystemMessage(`判断前端开发问题的类型：
- code_help：需要写/调试/优化代码
- concept：解释概念、原理、机制
- resource：推荐学习资料、工具、框架`),
    new HumanMessage(`问题：${question}`),
  ])

  console.log(`[分类结果] type=${result.type}, reason=${result.reason}`)

  return { questionType: result.type }
}

// 节点2a：代码帮助
async function codeHelpNode(state) {
  const question = state.messages[state.messages.length - 1].content
  const res = await model.invoke([
    new SystemMessage('你是前端工程师，直接给出代码解决方案，代码要有注释。'),
    new HumanMessage(question),
  ])
  return { answer: res.content }
}

// 节点2b：概念解释
async function conceptNode(state) {
  const question = state.messages[state.messages.length - 1].content
  const res = await model.invoke([
    new SystemMessage('你是技术讲师，先给出核心定义（1句），再用类比解释，最后举个实际例子。'),
    new HumanMessage(question),
  ])
  return { answer: res.content }
}

// 节点2c：资源推荐
async function resourceNode(state) {
  const question = state.messages[state.messages.length - 1].content
  const res = await model.invoke([
    new SystemMessage('你是前端学习规划师，推荐 3-5 个高质量学习资源，说明每个的适合人群。'),
    new HumanMessage(question),
  ])
  return { answer: res.content }
}

// 路由函数：根据 state.questionType 决定走哪条边
function routeQuestion(state) {
  const type = state.questionType
  if (type === 'code_help') return 'code_help'
  if (type === 'concept') return 'concept'
  if (type === 'resource') return 'resource'
  return 'concept' // 默认走概念解释
}

// 构建图
const router = new StateGraph(State)
  .addNode('classify', classifyNode)
  .addNode('code_help', codeHelpNode)
  .addNode('concept', conceptNode)
  .addNode('resource', resourceNode)
  .addEdge(START, 'classify')
  // 条件边：classify 节点执行完后，调用 routeQuestion 决定下一个节点
  .addConditionalEdges('classify', routeQuestion, {
    code_help: 'code_help',
    concept: 'concept',
    resource: 'resource',
  })
  .addEdge('code_help', END)
  .addEdge('concept', END)
  .addEdge('resource', END)
  .compile()

// 测试三种不同类型的问题
const questions = [
  'Vue3 中 v-for 和 v-if 同时使用时，哪个优先级更高？如何正确处理？',
  '帮我写一个 Vue3 的无限滚动加载组件',
  '我想系统学习 React，有什么推荐的学习路线？',
]

for (const question of questions) {
  console.log('\n' + '─'.repeat(60))
  console.log('问题：', question)

  const result = await router.invoke({
    messages: [new HumanMessage(question)],
  })

  console.log('路由到：', result.questionType)
  console.log('回答：', result.answer.slice(0, 200))
}

// ── 带循环的图：自我检查和修正 ──────────────────────────────
console.log('\n\n=== 带循环的图：代码生成 + 自我检查 ===')

const ReviewState = Annotation.Root({
  requirement: Annotation({ reducer: (_, n) => n, default: () => '' }),
  code: Annotation({ reducer: (_, n) => n, default: () => '' }),
  review: Annotation({ reducer: (_, n) => n, default: () => '' }),
  attempts: Annotation({ reducer: (_, n) => n, default: () => 0 }),
  passed: Annotation({ reducer: (_, n) => n, default: () => false }),
})

async function generateCodeNode(state) {
  const res = await model.invoke([
    new SystemMessage('你是 Vue3 工程师，生成符合要求的组件代码。'),
    new HumanMessage(`需求：${state.requirement}\n${state.review ? `上次审查意见：${state.review}，请修正。` : ''}`),
  ])
  return { code: res.content, attempts: state.attempts + 1 }
}

const ReviewSchema2 = z.object({
  passed: z.boolean(),
  issues: z.array(z.string()),
  summary: z.string(),
})

async function reviewCodeNode(state) {
  const reviewModel = model.withStructuredOutput(ReviewSchema2)
  const result = await reviewModel.invoke([
    new SystemMessage('审查 Vue3 代码，检查：类型安全、响应式正确使用、内存泄漏风险。'),
    new HumanMessage(`代码：\n${state.code}`),
  ])

  return {
    review: result.issues.join('; '),
    passed: result.passed,
  }
}

// 路由：通过了就结束，没通过且未超次数就重新生成
function routeReview(state) {
  if (state.passed) return 'end'
  if (state.attempts >= 2) return 'end' // 最多重试 2 次
  return 'regenerate'
}

const reviewGraph = new StateGraph(ReviewState)
  .addNode('generate', generateCodeNode)
  .addNode('review', reviewCodeNode)
  .addEdge(START, 'generate')
  .addEdge('generate', 'review')
  .addConditionalEdges('review', routeReview, {
    end: END,
    regenerate: 'generate',
  })
  .compile()

const reviewResult = await reviewGraph.invoke({
  requirement: '一个带 loading 状态和错误处理的数据获取 composable，用 Vue3 Composition API',
})

console.log(`生成次数：${reviewResult.attempts}`)
console.log(`最终审查通过：${reviewResult.passed}`)
console.log('最终代码：', reviewResult.code.slice(0, 300))
