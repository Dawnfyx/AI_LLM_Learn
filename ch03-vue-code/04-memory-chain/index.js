// 04-memory-chain/index.js
// 会话记忆：LangChain.js 的 ConversationChain 和手动实现记忆管理
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts'
import { InMemoryChatMessageHistory } from '@langchain/core/chat_history'
import { RunnableWithMessageHistory } from '@langchain/core/runnables'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0.7,
})

// ── 1. 手动管理会话历史 ───────────────────────────────────────
async function manualMemory() {
  console.log('\n=== 1. 手动管理历史 ===')

  class ChatSession {
    constructor(systemPrompt) {
      this.systemPrompt = systemPrompt
      this.history = []
    }

    async chat(userInput) {
      this.history.push(new HumanMessage(userInput))

      const messages = [
        new SystemMessage(this.systemPrompt),
        ...this.history,
      ]

      const res = await model.invoke(messages)
      this.history.push(new AIMessage(res.content))
      return res.content
    }

    // 历史太长时，只保留最近 N 轮
    trimHistory(maxTurns = 10) {
      if (this.history.length > maxTurns * 2) {
        this.history = this.history.slice(-maxTurns * 2)
      }
    }

    getHistory() {
      return this.history.map(m => ({
        role: m._getType() === 'human' ? 'user' : 'assistant',
        content: m.content.slice(0, 50) + '...',
      }))
    }
  }

  const session = new ChatSession('你是前端开发导师，记住学生的学习进度。')

  await session.chat('我是前端新手，刚学完 HTML 和 CSS')
  await session.chat('我想学 JavaScript，从哪里开始比较好？')
  const r3 = await session.chat('我之前说过我的基础是什么来着？')

  console.log('历史记录：', JSON.stringify(session.getHistory(), null, 2))
  console.log('第三轮回复（验证记忆）：', r3.slice(0, 100))
}

// ── 2. LangChain 内置记忆：RunnableWithMessageHistory ─────────
async function builtinMemory() {
  console.log('\n=== 2. RunnableWithMessageHistory ===')

  // 多个 session 的历史存储（实际项目中可以存 Redis 或数据库）
  const sessionHistories = {}

  function getHistory(sessionId) {
    if (!sessionHistories[sessionId]) {
      sessionHistories[sessionId] = new InMemoryChatMessageHistory()
    }
    return sessionHistories[sessionId]
  }

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', '你是一位 Vue3 技术导师，记住每位学生的学习进度。'],
    new MessagesPlaceholder('history'), // 历史消息注入位置
    ['human', '{input}'],
  ])

  const chain = prompt.pipe(model).pipe(new StringOutputParser())

  // 用 RunnableWithMessageHistory 包装链，自动管理历史
  const chainWithMemory = new RunnableWithMessageHistory({
    runnable: chain,
    getMessageHistory: getHistory,
    inputMessagesKey: 'input',
    historyMessagesKey: 'history',
  })

  const config1 = { configurable: { sessionId: 'student-alice' } }
  const config2 = { configurable: { sessionId: 'student-bob' } }

  // Alice 的对话
  await chainWithMemory.invoke({ input: '我刚开始学 Vue3' }, config1)
  const aliceR2 = await chainWithMemory.invoke({ input: '我上次说我在学什么？' }, config1)
  console.log('Alice 第二轮（验证记忆）：', aliceR2.slice(0, 100))

  // Bob 的对话（独立的 session，不会受 Alice 的历史影响）
  const bobR1 = await chainWithMemory.invoke({ input: '我在学 React，想切换到 Vue3' }, config2)
  console.log('Bob 第一轮：', bobR1.slice(0, 100))

  // 验证两个 session 完全独立
  const aliceHistory = await getHistory('student-alice').getMessages()
  const bobHistory = await getHistory('student-bob').getMessages()
  console.log(`Alice 历史长度：${aliceHistory.length}，Bob 历史长度：${bobHistory.length}`)
}

// ── 3. 滑动窗口记忆：避免上下文超长 ────────────────────────
async function slidingWindowMemory() {
  console.log('\n=== 3. 滑动窗口记忆 ===')

  class SlidingWindowChat {
    constructor({ systemPrompt, maxTokens = 2000 }) {
      this.systemPrompt = systemPrompt
      this.history = []
      this.maxTokens = maxTokens
    }

    // 简单估算 token 数
    estimateTokens(messages) {
      return messages.reduce((sum, m) => {
        const text = typeof m.content === 'string' ? m.content : ''
        return sum + Math.ceil(text.length * 0.6)
      }, 0)
    }

    // 超出限制时，从最早的消息开始删除（保留 system 消息）
    trimToFit() {
      while (
        this.history.length > 2 &&
        this.estimateTokens(this.history) > this.maxTokens
      ) {
        // 每次删除最早的一对（user + assistant）
        this.history.splice(0, 2)
      }
    }

    async chat(userInput) {
      this.history.push(new HumanMessage(userInput))
      this.trimToFit()

      const res = await model.invoke([
        new SystemMessage(this.systemPrompt),
        ...this.history,
      ])

      this.history.push(new AIMessage(res.content))
      return res.content
    }

    get historyLength() { return this.history.length }
  }

  const chat = new SlidingWindowChat({
    systemPrompt: '你是前端助手。',
    maxTokens: 500, // 测试用，设小一点
  })

  for (let i = 1; i <= 5; i++) {
    await chat.chat(`第 ${i} 个问题：Vue3 的第 ${i} 个特性是什么？`)
    console.log(`第 ${i} 轮后历史长度：${chat.historyLength}`)
  }
}

await manualMemory()
await builtinMemory()
await slidingWindowMemory()
