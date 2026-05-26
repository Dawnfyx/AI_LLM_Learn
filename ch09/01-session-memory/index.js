// 01-session-memory/index.js
// 会话记忆三种方案：全量历史 / 滑动窗口 / 摘要压缩
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { RunnableWithMessageHistory } from '@langchain/core/runnables'
import { InMemoryChatMessageHistory } from '@langchain/core/chat_history'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0.7,
})

// ── 方案一：全量历史 ──────────────────────────────────────────
// 优点：记忆完整；缺点：随对话轮次增加，token 消耗线性增长
class FullHistoryChat {
  constructor(systemPrompt) {
    this.systemPrompt = systemPrompt || '你是前端开发助手。'
    this.history = []
  }

  async chat(input) {
    this.history.push(new HumanMessage(input))
    const res = await model.invoke([new SystemMessage(this.systemPrompt), ...this.history])
    this.history.push(new AIMessage(res.content))
    return res.content
  }

  get tokenEstimate() {
    const text = this.history.map(m => m.content).join('')
    return Math.ceil(text.length * 0.6)
  }
}

// ── 方案二：滑动窗口 ──────────────────────────────────────────
// 只保留最近 maxTokens 范围内的历史，超出从最老的开始删
class SlidingWindowChat {
  constructor({ systemPrompt, maxTokens = 3000 } = {}) {
    this.systemPrompt = systemPrompt || '你是前端开发助手。'
    this.history = []
    this.maxTokens = maxTokens
  }

  estTokens() {
    return this.history.reduce(
      (s, m) => s + Math.ceil((m.content?.length ?? 0) * 0.6), 0
    )
  }

  trim() {
    while (this.history.length > 2 && this.estTokens() > this.maxTokens) {
      this.history.splice(0, 2)  // 成对删除，保证 user/assistant 不错位
    }
  }

  async chat(input) {
    this.history.push(new HumanMessage(input))
    this.trim()
    const res = await model.invoke([new SystemMessage(this.systemPrompt), ...this.history])
    this.history.push(new AIMessage(res.content))
    return res.content
  }
}

// ── 方案三：摘要压缩 ──────────────────────────────────────────
// 历史超过阈值时，用 AI 把老消息压缩成摘要注入 system，保留最近几轮原文
class SummaryChat {
  constructor({ systemPrompt, summaryThreshold = 8 } = {}) {
    this.systemPrompt = systemPrompt || '你是前端开发助手。'
    this.history = []
    this.summary = ''
    this.summaryThreshold = summaryThreshold
  }

  async compress() {
    if (this.history.length < this.summaryThreshold) return

    const oldMessages = this.history.slice(0, -4)  // 除最近2轮外的所有消息
    const histText = oldMessages
      .map(m => `${m._getType() === 'human' ? 'U' : 'A'}: ${m.content}`)
      .join('\n')

    const res = await model.invoke([
      new SystemMessage('将对话历史压缩为简洁摘要，保留关键信息，不超过100字。'),
      new HumanMessage(`对话：\n${histText}`),
    ])

    this.summary = res.content
    this.history = this.history.slice(-4)   // 只保留最近2轮原文
    console.log(`  [压缩] ${histText.length}字 → ${this.summary.length}字`)
  }

  async chat(input) {
    if (this.history.length >= this.summaryThreshold) await this.compress()

    this.history.push(new HumanMessage(input))

    const sys = this.summary
      ? `${this.systemPrompt}\n\n历史背景：${this.summary}`
      : this.systemPrompt

    const res = await model.invoke([new SystemMessage(sys), ...this.history])
    this.history.push(new AIMessage(res.content))
    return res.content
  }
}

// ── 方案四：RunnableWithMessageHistory（LangChain 内置）──────
const histories = {}
const getHistory = (id) => {
  if (!histories[id]) histories[id] = new InMemoryChatMessageHistory()
  return histories[id]
}

const chainWithMemory = new RunnableWithMessageHistory({
  runnable: ChatPromptTemplate.fromMessages([
    ['system', '你是前端学习助手，记住学生的学习进度。'],
    new MessagesPlaceholder('history'),
    ['human', '{input}'],
  ]).pipe(model).pipe(new StringOutputParser()),
  getMessageHistory: getHistory,
  inputMessagesKey: 'input',
  historyMessagesKey: 'history',
})

// ── 对比测试 ──────────────────────────────────────────────────
async function runTest() {
  const questions = [
    '我在学 Vue3，目前只会 ref 和 reactive',
    '能讲一下 computed 吗？',
    '那 watch 和 watchEffect 区别是？',
    '我一开始说我的学习起点是什么？',   // 验证记忆
  ]

  console.log('=== 方案一：全量历史 ===')
  const full = new FullHistoryChat()
  for (const q of questions) {
    const r = await full.chat(q)
    console.log(`  Q: ${q}\n  A: ${r.slice(0, 80)}...\n`)
  }
  console.log('历史 token 估算：', full.tokenEstimate)

  console.log('\n=== 方案三：摘要压缩 (threshold=4) ===')
  const summary = new SummaryChat({ summaryThreshold: 4 })
  for (const q of questions) {
    const r = await summary.chat(q)
    console.log(`  A: ${r.slice(0, 70)}...`)
  }

  console.log('\n=== 方案四：RunnableWithMessageHistory ===')
  const cfg = { configurable: { sessionId: 'stu-001' } }
  await chainWithMemory.invoke({ input: '我现在在做 Vue3 毕设项目' }, cfg)
  const r4 = await chainWithMemory.invoke({ input: '我之前说我在做什么？' }, cfg)
  console.log('验证记忆：', r4.slice(0, 100))
}

await runTest()
