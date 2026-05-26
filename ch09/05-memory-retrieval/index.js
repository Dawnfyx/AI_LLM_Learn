// 05-memory-retrieval/index.js
// 记忆检索：用向量相似度检索最相关的记忆片段（语义检索 vs 关键词检索）
// 结合第六章的 RAG：把记忆当作"私人知识库"
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { OpenAIEmbeddings } from '@langchain/openai'
import { MemoryVectorStore } from 'langchain/vectorstores/memory'
import { Document } from '@langchain/core/documents'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0.7,
})

const embeddings = new OpenAIEmbeddings({
  model: 'text-embedding-3-small',
  apiKey: process.env.OPENAI_API_KEY,
})

// ── 向量记忆库 ────────────────────────────────────────────────
class VectorMemoryStore {
  constructor() {
    this.stores = new Map()  // userId → MemoryVectorStore
  }

  async getStore(userId) {
    if (!this.stores.has(userId)) {
      const store = new MemoryVectorStore(embeddings)
      this.stores.set(userId, store)
    }
    return this.stores.get(userId)
  }

  // 添加记忆（向量化后存储）
  async addMemory(userId, { content, category, importance, timestamp = new Date() }) {
    const store = await this.getStore(userId)
    const doc = new Document({
      pageContent: content,
      metadata: {
        userId,
        category,
        importance,
        timestamp: timestamp.toISOString(),
      },
    })
    await store.addDocuments([doc])
    console.log(`  [向量库] 存入记忆：${content.slice(0, 50)}`)
  }

  // 语义检索：找到最相关的记忆
  async searchMemories(userId, query, k = 5) {
    const store = await this.getStore(userId)
    const results = await store.similaritySearchWithScore(query, k)
    return results
      .filter(([, score]) => score > 0.3)
      .map(([doc, score]) => ({
        content: doc.pageContent,
        ...doc.metadata,
        relevanceScore: score,
      }))
  }

  // 关键词过滤 + 语义检索的混合查询
  async hybridSearch(userId, query, { category, minImportance = 1, k = 5 } = {}) {
    const results = await this.searchMemories(userId, query, k * 2)
    return results
      .filter(m => {
        if (category && m.category !== category) return false
        if (m.importance < minImportance) return false
        return true
      })
      .slice(0, k)
  }

  // 构建相关记忆上下文
  async buildRelevantContext(userId, currentInput) {
    const memories = await this.hybridSearch(userId, currentInput, { minImportance: 2 })
    if (memories.length === 0) return ''

    const contextLines = memories.map(m =>
      `[${m.category}|重要性${m.importance}] ${m.content}`
    )
    return contextLines.join('\n')
  }
}

// ── 带记忆检索的对话 ──────────────────────────────────────────
class MemoryEnabledChat {
  constructor(userId) {
    this.userId = userId
    this.vectorStore = new VectorMemoryStore()
    this.sessionHistory = []
    this.turnCount = 0
  }

  // 预加载记忆（模拟历史会话中积累的记忆）
  async loadHistoricalMemories(memories) {
    for (const mem of memories) {
      await this.vectorStore.addMemory(this.userId, mem)
    }
    console.log(`已加载 ${memories.length} 条历史记忆`)
  }

  // 发送消息：检索相关记忆 → 注入上下文 → 生成回复 → 存储新记忆
  async chat(userInput) {
    this.turnCount++

    // 1. 检索与当前输入最相关的记忆
    const relevantMemories = await this.vectorStore.buildRelevantContext(this.userId, userInput)

    // 2. 构建带记忆的系统提示
    const systemParts = ['你是个性化前端助手，根据用户背景提供定制化回答。']
    if (relevantMemories) {
      systemParts.push(`\n相关用户背景：\n${relevantMemories}`)
    }

    // 3. 调用模型
    const response = await model.invoke([
      new SystemMessage(systemParts.join('\n')),
      ...this.sessionHistory,
      new HumanMessage(userInput),
    ])

    // 4. 更新会话历史
    this.sessionHistory.push(new HumanMessage(userInput))
    this.sessionHistory.push(response)

    // 5. 从本轮提取新记忆（简化版，直接存重要信息）
    // 实际项目里用 extractMemoriesFromTurn 自动提取
    const importantPatterns = [
      { pattern: /我在做(.+项目)/, category: 'fact', importance: 4 },
      { pattern: /我想学(.+)/, category: 'goal', importance: 5 },
      { pattern: /我不喜欢(.+)/, category: 'preference', importance: 3 },
    ]

    for (const { pattern, category, importance } of importantPatterns) {
      const match = userInput.match(pattern)
      if (match) {
        await this.vectorStore.addMemory(this.userId, {
          content: userInput.slice(0, 100),
          category,
          importance,
        })
      }
    }

    return {
      reply: response.content,
      usedMemories: relevantMemories ? relevantMemories.split('\n').length : 0,
    }
  }
}

// ── 演示 ─────────────────────────────────────────────────────
async function demo() {
  console.log('=== 向量记忆检索演示 ===\n')

  try {
    const chat = new MemoryEnabledChat('user_001')

    // 预加载历史记忆（模拟之前对话积累的）
    await chat.loadHistoricalMemories([
      { content: '是前端工程师，Vue3 主要技术栈', category: 'fact', importance: 5 },
      { content: '不喜欢使用 Vuex，觉得太复杂，偏好 Pinia', category: 'preference', importance: 4 },
      { content: '当前项目：医疗 SaaS 后台，3个月deadline', category: 'fact', importance: 5 },
      { content: '学习目标：年底前掌握 TypeScript', category: 'goal', importance: 5 },
      { content: '踩过坑：v-for 忘加 key 导致的渲染问题', category: 'event', importance: 3 },
      { content: 'React 基础了解但不熟练，主要工作在 Vue 生态', category: 'fact', importance: 3 },
    ])

    console.log('\n开始对话...\n')

    // 问题1：会检索到偏好相关记忆
    const r1 = await chat.chat('状态管理方案你怎么推荐？')
    console.log(`Q: 状态管理方案你怎么推荐？`)
    console.log(`A: ${r1.reply.slice(0, 150)}`)
    console.log(`使用了 ${r1.usedMemories} 条记忆\n`)

    // 问题2：会检索到项目和目标相关记忆
    const r2 = await chat.chat('TypeScript 学习路线怎么规划比较好？')
    console.log(`Q: TypeScript 学习路线怎么规划比较好？`)
    console.log(`A: ${r2.reply.slice(0, 150)}`)
    console.log(`使用了 ${r2.usedMemories} 条记忆\n`)

    // 直接测试向量检索
    console.log('=== 直接测试向量检索 ===')
    const store = new VectorMemoryStore()
    await store.addMemory('u1', { content: '用 Vue3，有3年经验', category: 'fact', importance: 5 })
    await store.addMemory('u1', { content: '讨厌写测试，觉得浪费时间', category: 'preference', importance: 3 })
    await store.addMemory('u1', { content: '想做开源项目提升影响力', category: 'goal', importance: 4 })

    const results = await store.searchMemories('u1', '前端工程师的背景')
    console.log('检索"前端工程师的背景"：')
    results.forEach(r => console.log(`  score=${r.relevanceScore.toFixed(3)} | ${r.content}`))

  } catch (e) {
    if (e.message.includes('OPENAI_API_KEY')) {
      console.log('需要 OPENAI_API_KEY 才能使用向量检索。')
      console.log('关键概念：向量检索比关键词检索更能找到语义相关的记忆。')
      console.log('例如：搜索"状态管理建议"能找到"不喜欢 Vuex，偏好 Pinia"这条记忆。')
    } else {
      throw e
    }
  }
}

await demo()
