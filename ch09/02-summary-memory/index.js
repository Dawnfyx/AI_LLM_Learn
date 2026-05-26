// 02-summary-memory/index.js
// 摘要记忆：对话变长时，用模型把早期对话压缩成摘要，节省 token
// 核心：旧历史 → 摘要（少量 token）+ 近期对话（完整保留）
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0.3,
})

// ── 摘要记忆管理器 ────────────────────────────────────────────
class SummaryMemory {
  constructor({
    summaryThreshold = 10,   // 超过多少条消息触发摘要
    keepRecentMessages = 4,  // 摘要后保留最近几条完整消息
    summaryModel = null,
  } = {}) {
    this.summary = ''              // 已压缩的历史摘要
    this.recentMessages = []       // 最近的完整消息
    this.summaryThreshold = summaryThreshold
    this.keepRecentMessages = keepRecentMessages
    this.summaryModel = summaryModel || model
    this.totalRounds = 0
  }

  async addExchange(userMsg, assistantMsg) {
    this.recentMessages.push(
      new HumanMessage(userMsg),
      new AIMessage(assistantMsg)
    )
    this.totalRounds++

    // 触发摘要压缩
    if (this.recentMessages.length > this.summaryThreshold) {
      await this._compress()
    }
  }

  async _compress() {
    // 要压缩的部分：最近消息中较早的那些
    const toCompress = this.recentMessages.slice(
      0,
      this.recentMessages.length - this.keepRecentMessages
    )
    this.recentMessages = this.recentMessages.slice(
      -this.keepRecentMessages
    )

    // 格式化待压缩的历史
    const historyText = toCompress
      .map(m => `${m._getType() === 'human' ? '用户' : '助手'}：${m.content}`)
      .join('\n')

    // 让模型生成摘要
    const response = await this.summaryModel.invoke([
      new SystemMessage(
        '你是对话摘要专家。将以下对话历史压缩成简洁的摘要，保留关键信息：用户的技术背景、提出的问题、重要结论。' +
        (this.summary ? `\n\n已有摘要：${this.summary}` : '')
      ),
      new HumanMessage(`请更新摘要，加入以下新的对话内容：\n\n${historyText}`),
    ])

    this.summary = response.content
    console.log(`  [摘要压缩] 压缩了 ${toCompress.length} 条消息`)
    console.log(`  新摘要：${this.summary.slice(0, 80)}...`)
  }

  // 构建发给模型的完整消息列表
  buildMessages(systemPrompt, userInput) {
    const messages = [new SystemMessage(systemPrompt)]

    // 如果有摘要，以系统消息形式注入
    if (this.summary) {
      messages.push(
        new SystemMessage(`【对话历史摘要】\n${this.summary}`)
      )
    }

    // 添加最近的完整消息
    messages.push(...this.recentMessages)
    messages.push(new HumanMessage(userInput))

    return messages
  }

  getStats() {
    const recentTokens = this.recentMessages.reduce(
      (sum, m) => sum + Math.ceil(m.content.length * 0.6), 0
    )
    const summaryTokens = Math.ceil(this.summary.length * 0.6)
    return {
      totalRounds: this.totalRounds,
      recentMessages: this.recentMessages.length,
      summaryLength: this.summary.length,
      estimatedTokens: recentTokens + summaryTokens,
    }
  }
}

// ── 对比：不摘要 vs 摘要记忆的 token 消耗 ────────────────────
async function compareMemoryStrategies() {
  console.log('=== 摘要记忆 vs 滑动窗口对比 ===\n')

  const summaryMemory = new SummaryMemory({
    summaryThreshold: 6,
    keepRecentMessages: 4,
  })

  // 模拟一段较长的技术对话
  const conversation = [
    ['我是一个有 3 年经验的前端开发者，主要用 Vue2', '您好！很高兴认识您，Vue2 经验很扎实。'],
    ['我想学 Vue3，需要知道哪些核心变化？', 'Vue3 核心变化：Composition API、更好的 TypeScript 支持...'],
    ['Composition API 和 Options API 有什么本质区别？', 'Options API 按选项类型组织（data/methods/computed），Composition API 按逻辑功能组织...'],
    ['我的项目需要支持 IE11，能用 Vue3 吗？', 'Vue3 放弃了 IE11 支持，因为使用了 Proxy...'],
    ['那我如果不需要 IE11，迁移到 Vue3 的步骤是什么？', '迁移步骤：1. 升级依赖 2. 处理破坏性变更 3. 逐步迁移组件...'],
    ['Pinia 和 Vuex4 有什么区别？', 'Pinia 是 Vue3 的官方推荐状态管理，更简洁、更好的 TS 支持...'],
    ['我前面提到我有几年经验？', '您提到您有 3 年前端开发经验，主要使用 Vue2。'],  // 测试摘要后是否记住
  ]

  for (const [user, assistant] of conversation) {
    // 模拟对话（实际项目里 assistant 是模型生成的）
    const messages = summaryMemory.buildMessages(
      '你是 Vue3 迁移专家，帮助用户从 Vue2 迁移。',
      user
    )

    // 实际调用（这里用预设回答避免 API 消耗）
    await summaryMemory.addExchange(user, assistant)

    const stats = summaryMemory.getStats()
    console.log(`轮次 ${stats.totalRounds}: tokens≈${stats.estimatedTokens}（最近${stats.recentMessages}条消息 + 摘要${stats.summaryLength}字）`)
  }

  console.log('\n最终摘要内容：')
  console.log(summaryMemory.summary)
}

await compareMemoryStrategies()
