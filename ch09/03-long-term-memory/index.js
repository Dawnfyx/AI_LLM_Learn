// 03-long-term-memory/index.js
// 长期记忆：用向量数据库存储重要信息，按语义相关性检索
// 短期记忆（当前对话）+ 长期记忆（跨会话历史）结合
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { OpenAIEmbeddings } from '@langchain/openai'
import { MemoryVectorStore } from 'langchain/vectorstores/memory'
import { Document } from '@langchain/core/documents'
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'
import { z } from 'zod'
import crypto from 'crypto'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0.7,
})

// 注：embeddings 用 OpenAI 的模型，如无 OpenAI Key 可用 HuggingFace 本地模型
const embeddings = new OpenAIEmbeddings({
  model: 'text-embedding-3-small',
  apiKey: process.env.OPENAI_API_KEY,
})

// ── 记忆类型 ──────────────────────────────────────────────────
// episodic：情节记忆（发生了什么事）
// semantic：语义记忆（学到了什么知识）
// preference：偏好记忆（用户喜欢什么）

// ── 长期记忆管理器 ────────────────────────────────────────────
class LongTermMemory {
  constructor(userId) {
    this.userId = userId
    this.vectorStore = null
    this.initialized = false
  }

  async init() {
    if (this.initialized) return
    this.vectorStore = new MemoryVectorStore(embeddings)
    this.initialized = true
  }

  // 判断一轮对话是否值得记住
  async shouldRemember(userMsg, aiMsg) {
    const JudgeSchema = z.object({
      shouldStore: z.boolean(),
      memoryType: z.enum(['episodic', 'semantic', 'preference']).optional(),
      summary: z.string().optional().describe('如果要存储，生成简洁摘要'),
      importance: z.number().min(1).max(5).optional(),
    })

    const judgeModel = model.withStructuredOutput(JudgeSchema)
    return judgeModel.invoke([
      new SystemMessage(`判断这轮对话是否包含值得长期记忆的信息。
值得记忆的类型：
- episodic：用户提到的事件、经历（如"我最近在做某项目"）
- semantic：用户学到的重要知识点
- preference：用户的明显偏好（如"我不喜欢用 TypeScript"）
不值得记忆：纯粹的问答、没有个人信息的技术解答`),
      new HumanMessage(`用户：${userMsg}\nAI：${aiMsg.slice(0, 200)}`),
    ])
  }

  // 存储一条记忆
  async store(content, metadata = {}) {
    await this.init()
    const id = crypto.randomUUID()
    const doc = new Document({
      pageContent: content,
      metadata: {
        userId: this.userId,
        id,
        createdAt: new Date().toISOString(),
        ...metadata,
      },
    })
    await this.vectorStore.addDocuments([doc])
    return id
  }

  // 按语义相关性检索记忆
  async recall(query, k = 3) {
    await this.init()
    const docs = await this.vectorStore.similaritySearchWithScore(query, k)
    return docs
      .filter(([, score]) => score > 0.3)
      .map(([doc, score]) => ({ ...doc.metadata, content: doc.pageContent, score }))
  }

  // 把检索到的记忆格式化为 system 上下文
  formatForContext(memories) {
    if (!memories.length) return ''
    return '\n\n相关历史记忆：\n' +
      memories.map((m, i) =>
        `[${i + 1}] (${m.memoryType || '记忆'}, ${new Date(m.createdAt).toLocaleDateString()}) ${m.content}`
      ).join('\n')
  }
}

// ── 带长期记忆的对话类 ────────────────────────────────────────
class MemoryAugmentedChat {
  constructor(userId) {
    this.userId = userId
    this.ltm = new LongTermMemory(userId)
    this.shortTermHistory = []   // 当前会话的短期记忆
    this.sessionCount = 0
  }

  async chat(userInput) {
    // 1. 检索相关的长期记忆
    const relevantMemories = await this.ltm.recall(userInput)
    const memCtx = this.ltm.formatForContext(relevantMemories)

    if (relevantMemories.length) {
      console.log(`  [记忆检索] 找到 ${relevantMemories.length} 条相关记忆`)
      relevantMemories.forEach(m => console.log(`    - [${m.memoryType}] ${m.content.slice(0, 60)}`))
    }

    // 2. 组合 system 提示（短期记忆 + 长期记忆）
    const systemContent = `你是前端开发助手，根据记忆提供个性化回答。${memCtx}`

    // 3. 生成回复
    this.shortTermHistory.push(new HumanMessage(userInput))
    const res = await model.invoke([
      new SystemMessage(systemContent),
      ...this.shortTermHistory.slice(-6),   // 短期只保留最近3轮
    ])
    this.shortTermHistory.push(new AIMessage(res.content))

    // 4. 判断是否值得存入长期记忆
    const { shouldStore, memoryType, summary, importance } =
      await this.ltm.shouldRemember(userInput, res.content)

    if (shouldStore && summary) {
      await this.ltm.store(summary, { memoryType, importance })
      console.log(`  [存入长期记忆] type=${memoryType}, importance=${importance}: ${summary.slice(0, 60)}`)
    }

    return res.content
  }

  // 清空短期记忆（模拟重新开一个会话）
  newSession() {
    this.shortTermHistory = []
    this.sessionCount++
    console.log(`\n--- 新会话 #${this.sessionCount} ---`)
  }
}

// ── 测试跨会话记忆 ────────────────────────────────────────────
async function testCrossSessionMemory() {
  console.log('=== 跨会话长期记忆测试 ===\n')

  const chat = new MemoryAugmentedChat('user-bob')

  // 会话1：告诉 AI 一些个人信息
  console.log('=== 会话1 ===')
  await chat.chat('我叫 Bob，在一家电商公司做前端 lead，主要维护 Vue2 老项目')
  await chat.chat('我们准备今年把核心业务从 Vue2 迁到 Vue3，时间比较紧')

  // 开始新会话（清除短期记忆）
  chat.newSession()

  // 会话2：不重复介绍，直接提问
  console.log('=== 会话2（不重复介绍）===')
  const r = await chat.chat('Vue2 迁移到 Vue3 有哪些需要注意的地方？')
  console.log('\n回答（AI 应该知道我的背景）：')
  console.log(r.slice(0, 300))
}

await testCrossSessionMemory()
