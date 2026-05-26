// 04-human-in-loop/index.js
// Human-in-the-Loop：工作流执行到关键节点时暂停，等待人工审核后继续
// 场景：内容发布流程 - AI 生成内容 → 人工审核 → 发布或修改
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { StateGraph, END, START, Annotation, messagesStateReducer } from '@langchain/langgraph'
import { MemorySaver } from '@langchain/langgraph'
import { HumanMessage, AIMessage } from '@langchain/core/messages'
import * as readline from 'readline'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0.7,
})

// MemorySaver：把工作流状态持久化（生产中换成 PostgresSaver 或 RedisSaver）
const checkpointer = new MemorySaver()

// ── 状态定义 ──────────────────────────────────────────────────
const State = Annotation.Root({
  topic:         Annotation({ reducer: (_, n) => n, default: () => '' }),
  draft:         Annotation({ reducer: (_, n) => n, default: () => '' }),
  humanFeedback: Annotation({ reducer: (_, n) => n, default: () => '' }),
  revision:      Annotation({ reducer: (_, n) => n, default: () => '' }),
  published:     Annotation({ reducer: (_, n) => n, default: () => false }),
  publishedAt:   Annotation({ reducer: (_, n) => n, default: () => '' }),
})

// ── 节点1：AI 生成草稿 ────────────────────────────────────────
async function generateDraftNode(state) {
  console.log('\n[AI] 生成内容草稿...')

  const res = await model.invoke([
    { role: 'system', content: '你是技术博主，写作风格简洁有料，适合前端开发者阅读。' },
    { role: 'user', content: `写一篇关于"${state.topic}"的短文（200字左右），包含1个实用代码示例。` },
  ])

  console.log('\n生成的草稿：\n', res.content)
  return { draft: res.content }
}

// ── 节点2：人工审核（中断点）────────────────────────────────
// interrupt 让工作流在此暂停，等待外部输入
async function humanReviewNode(state) {
  // 这个节点本身不做任何事
  // 工作流会在 interrupt_before: ['human_review'] 配置处暂停
  console.log('\n[等待人工审核] 工作流已暂停，等待审核意见...')
  return {}
}

// ── 节点3：根据反馈修改 ────────────────────────────────────
async function reviseNode(state) {
  if (!state.humanFeedback || state.humanFeedback.trim() === 'ok') {
    console.log('\n[修改] 无需修改，使用原稿')
    return { revision: state.draft }
  }

  console.log('\n[AI] 根据反馈修改...')

  const res = await model.invoke([
    { role: 'system', content: '你是文章编辑，根据反馈精准修改内容。' },
    { role: 'user', content: `原文：\n${state.draft}\n\n审核意见：${state.humanFeedback}\n\n修改后的版本：` },
  ])

  console.log('\n修改后：\n', res.content.slice(0, 200))
  return { revision: res.content }
}

// ── 节点4：发布 ──────────────────────────────────────────────
async function publishNode(state) {
  console.log('\n[发布] 内容已发布！')
  return {
    published: true,
    publishedAt: new Date().toISOString(),
  }
}

// ── 构建带中断点的工作流 ──────────────────────────────────────
const publishWorkflow = new StateGraph(State)
  .addNode('generate_draft', generateDraftNode)
  .addNode('human_review',   humanReviewNode)
  .addNode('revise',         reviseNode)
  .addNode('publish',        publishNode)
  .addEdge(START,             'generate_draft')
  .addEdge('generate_draft',  'human_review')
  .addEdge('human_review',    'revise')
  .addEdge('revise',          'publish')
  .addEdge('publish',          END)
  .compile({
    checkpointer,
    // 在 human_review 节点前中断，等待人工干预
    interruptBefore: ['human_review'],
  })

// ── 命令行交互工具 ────────────────────────────────────────────
function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => {
    rl.question(question, (answer) => { rl.close(); resolve(answer) })
  })
}

// ── 运行 Human-in-the-Loop 工作流 ────────────────────────────
async function runWithHumanReview(topic) {
  const threadId = `thread_${Date.now()}`
  const config = { configurable: { thread_id: threadId } }

  console.log(`\n开始工作流（thread: ${threadId}）`)

  // 第一次运行：执行到中断点（human_review 前）自动暂停
  let state = await publishWorkflow.invoke(
    { topic },
    config
  )

  // 检查工作流是否已暂停（到达中断点）
  const currentState = await publishWorkflow.getState(config)
  console.log('\n当前状态：', currentState.next)  // ['human_review']

  if (currentState.next?.includes('human_review')) {
    console.log('\n' + '═'.repeat(50))
    console.log('工作流已暂停，等待人工审核')
    console.log('═'.repeat(50))
    console.log('\n草稿内容已显示，请审核...')

    // 等待人工输入
    const feedback = await prompt('\n请输入审核意见（直接回车表示通过，或输入修改建议）：')

    // 更新状态：注入人工反馈
    await publishWorkflow.updateState(config, {
      humanFeedback: feedback || 'ok',
    })

    // 继续执行工作流（从中断点之后继续）
    const finalState = await publishWorkflow.invoke(null, config)

    console.log('\n=== 工作流完成 ===')
    console.log('发布时间：', finalState.publishedAt)
    console.log('最终内容（前200字）：', finalState.revision?.slice(0, 200))
  }
}

// ── 简化版：不使用 readline，直接注入预设反馈（便于测试）────
async function runSimulated() {
  const threadId = `sim_${Date.now()}`
  const config = { configurable: { thread_id: threadId } }

  // 第一次运行（到中断点停止）
  await publishWorkflow.invoke({ topic: 'Vue3 响应式原理' }, config)

  const st = await publishWorkflow.getState(config)
  console.log('工作流暂停于：', st.next)

  // 模拟人工注入反馈
  const simulatedFeedback = '代码示例改用 TypeScript，并补充一个实际业务场景'
  console.log('\n模拟人工反馈：', simulatedFeedback)

  await publishWorkflow.updateState(config, { humanFeedback: simulatedFeedback })

  // 继续执行
  const result = await publishWorkflow.invoke(null, config)
  console.log('\n工作流完成，已发布：', result.published)
  console.log('最终内容（前150字）：', result.revision?.slice(0, 150))
}

// 运行模拟版本（不需要 readline 交互）
await runSimulated()
