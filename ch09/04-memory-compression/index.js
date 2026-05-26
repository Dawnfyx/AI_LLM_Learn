// 04-memory-compression/index.js
// 上下文窗口管理：token 计数、动态压缩、重要信息保留
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'
import { z } from 'zod'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0,
})

// ── 工具函数：token 估算 ──────────────────────────────────────
function estimateTokens(text) {
  const cnChars = (text.match(/[\u4e00-\u9fff]/g) || []).length
  const otherChars = text.length - cnChars
  return Math.ceil(cnChars * 0.6 + otherChars * 0.25)
}

function estimateMessagesTokens(messages) {
  return messages.reduce(
    (sum, m) => sum + estimateTokens(typeof m.content === 'string' ? m.content : ''), 0
  )
}

// ── 策略一：Token 感知的滑动窗口 ─────────────────────────────
class TokenAwareSlidingWindow {
  constructor({ maxContextTokens = 4000, reserveForOutput = 1000 } = {}) {
    this.maxContextTokens = maxContextTokens
    this.reserveForOutput = reserveForOutput
    this.availableTokens = maxContextTokens - reserveForOutput
    this.history = []
    this.stats = { compressed: 0, dropped: 0 }
  }

  // 计算可以保留多少条消息
  fitInWindow(messages) {
    const result = []
    let total = 0
    // 从最新消息往前遍历
    for (let i = messages.length - 1; i >= 0; i--) {
      const t = estimateTokens(messages[i].content || '')
      if (total + t > this.availableTokens) break
      result.unshift(messages[i])
      total += t
    }
    return result
  }

  async chat(input, systemPrompt = '你是前端助手。') {
    this.history.push(new HumanMessage(input))

    const sysTokens = estimateTokens(systemPrompt)
    this.availableTokens = this.maxContextTokens - this.reserveForOutput - sysTokens

    // 找到能放进窗口的消息
    const fittedHistory = this.fitInWindow(this.history)
    const dropped = this.history.length - fittedHistory.length

    if (dropped > 0) {
      this.stats.dropped += dropped
      console.log(`  [窗口] 丢弃 ${dropped} 条旧消息，保留 ${fittedHistory.length} 条`)
    }

    const res = await model.invoke([new SystemMessage(systemPrompt), ...fittedHistory])
    this.history.push(new AIMessage(res.content))
    return res.content
  }
}

// ── 策略二：重要信息提取 + 摘要 ──────────────────────────────
class ImportanceAwareMemory {
  constructor({ maxHistory = 10, importanceThreshold = 3 } = {}) {
    this.maxHistory = maxHistory
    this.importanceThreshold = importanceThreshold
    // 分级存储
    this.pinnedMessages = []   // 重要信息，不参与淘汰
    this.regularHistory = []   // 普通历史，按策略淘汰
    this.summary = ''
  }

  async scoreImportance(message) {
    const ScoreSchema = z.object({
      score: z.number().min(1).max(5),
      reason: z.string(),
      shouldPin: z.boolean().describe('是否应该永久保留'),
      extractedFact: z.string().optional().describe('如果包含重要事实，提取出来'),
    })

    const scoreModel = model.withStructuredOutput(ScoreSchema)
    return scoreModel.invoke([
      new SystemMessage(`评估消息的重要性（1-5分）：
5分：用户的核心需求、明确偏好、关键约束（如"我们的项目不能用 TypeScript"）
4分：用户的背景信息（技术水平、工作场景）
3分：重要的技术问题
2分：普通问答
1分：闲聊、重复信息`),
      new HumanMessage(typeof message.content === 'string' ? message.content : ''),
    ])
  }

  async addMessage(message) {
    const { score, shouldPin, extractedFact } = await this.scoreImportance(message)

    if (shouldPin || score >= this.importanceThreshold) {
      // 重要消息：存储提取的事实或原文
      this.pinnedMessages.push({
        content: extractedFact || message.content,
        score,
        createdAt: new Date().toISOString(),
      })
      console.log(`  [置顶] score=${score}: ${(extractedFact || message.content).slice(0, 60)}`)
    } else {
      this.regularHistory.push(message)
      // 普通历史超出限制时淘汰最老的
      if (this.regularHistory.length > this.maxHistory) {
        this.regularHistory.shift()
      }
    }
  }

  buildContext() {
    const parts = []
    if (this.pinnedMessages.length) {
      parts.push('重要背景：\n' + this.pinnedMessages.map(m => `- ${m.content}`).join('\n'))
    }
    if (this.summary) {
      parts.push('历史摘要：' + this.summary)
    }
    return parts.join('\n\n')
  }

  async chat(input, systemPrompt = '你是前端助手。') {
    const userMsg = new HumanMessage(input)
    await this.addMessage(userMsg)

    const context = this.buildContext()
    const fullSystem = context ? `${systemPrompt}\n\n${context}` : systemPrompt

    const res = await model.invoke([
      new SystemMessage(fullSystem),
      ...this.regularHistory.slice(-6),
      userMsg,
    ])

    await this.addMessage(new AIMessage(res.content))
    return res.content
  }
}

// ── 策略三：分层记忆架构 ─────────────────────────────────────
// L1: 工作记忆（当前几轮）
// L2: 会话摘要（本次会话的压缩）
// L3: 长期记忆（跨会话的重要信息）
class LayeredMemory {
  constructor() {
    this.l1 = []        // 工作记忆：最近 6 条
    this.l2 = ''        // 会话摘要
    this.l3 = []        // 长期记忆条目
    this.turnCount = 0
    this.l2UpdateInterval = 4  // 每 4 轮更新一次摘要
  }

  async updateL2() {
    if (this.l1.length < 2) return
    const histText = this.l1.map(m =>
      `${m._getType() === 'human' ? 'U' : 'A'}: ${m.content}`
    ).join('\n')

    const res = await model.invoke([
      new SystemMessage('把对话总结成简洁摘要，重点保留用户相关的信息，不超过80字。'),
      new HumanMessage(histText),
    ])
    this.l2 = res.content
    console.log(`  [L2更新] 摘要：${this.l2.slice(0, 60)}...`)
  }

  async chat(input, systemPrompt = '你是前端助手。') {
    this.turnCount++

    // 定期更新会话摘要
    if (this.turnCount % this.l2UpdateInterval === 0) {
      await this.updateL2()
    }

    this.l1.push(new HumanMessage(input))
    if (this.l1.length > 6) this.l1.shift()

    // 组合三层记忆
    const memParts = []
    if (this.l3.length) memParts.push(`长期记忆：${this.l3.join('; ')}`)
    if (this.l2) memParts.push(`本次会话：${this.l2}`)
    const context = memParts.join('\n')

    const res = await model.invoke([
      new SystemMessage(context ? `${systemPrompt}\n\n${context}` : systemPrompt),
      ...this.l1.slice(-4),
    ])

    this.l1.push(new AIMessage(res.content))
    if (this.l1.length > 6) this.l1.shift()

    return res.content
  }

  // 会话结束时，把重要信息提升到 L3
  promoteToL3(fact) {
    this.l3.push(fact)
    console.log(`  [L3提升] ${fact}`)
  }
}

// 测试
async function test() {
  console.log('=== Token 感知滑动窗口 ===\n')
  const window = new TokenAwareSlidingWindow({ maxContextTokens: 500, reserveForOutput: 100 })
  for (let i = 1; i <= 5; i++) {
    await window.chat(`第${i}轮对话，Vue3 问题${i}`)
  }
  console.log('丢弃统计：', window.stats)

  console.log('\n=== 分层记忆架构 ===\n')
  const layered = new LayeredMemory()
  layered.promoteToL3('用户是 Vue3 Senior，有 5 年经验')  // 手动提升已知信息
  await layered.chat('帮我看看这个 Pinia store 设计合不合理')
  await layered.chat('computed 和 getters 有什么区别？')
  await layered.chat('推荐一个处理异步的 action 模式')
  await layered.chat('能结合我的经验给建议吗？')  // 验证 L3 记忆
}

await test()
