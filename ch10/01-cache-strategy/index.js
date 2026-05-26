// 01-cache-strategy/index.js
// 缓存策略：语义缓存 + 精确缓存，减少重复调用
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { OpenAIEmbeddings } from '@langchain/openai'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import crypto from 'crypto'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0,
})

// ── 1. 精确缓存（MD5 hash）────────────────────────────────────
// 完全相同的问题直接返回缓存，不调 API
class ExactCache {
  constructor({ ttl = 3600000 } = {}) {  // 默认 1 小时过期
    this.cache = new Map()
    this.ttl = ttl
    this.stats = { hits: 0, misses: 0 }
  }

  key(messages) {
    const content = messages.map(m => `${m._getType()}:${m.content}`).join('|')
    return crypto.createHash('md5').update(content).digest('hex')
  }

  get(messages) {
    const k = this.key(messages)
    const entry = this.cache.get(k)
    if (!entry) { this.stats.misses++; return null }

    if (Date.now() - entry.createdAt > this.ttl) {
      this.cache.delete(k)
      this.stats.misses++
      return null
    }

    this.stats.hits++
    console.log(`  [缓存命中] key=${k.slice(0, 8)}...`)
    return entry.value
  }

  set(messages, value) {
    const k = this.key(messages)
    this.cache.set(k, { value, createdAt: Date.now() })
  }

  get hitRate() {
    const total = this.stats.hits + this.stats.misses
    return total === 0 ? 0 : (this.stats.hits / total * 100).toFixed(1)
  }
}

// 带精确缓存的模型封装
class CachedModel {
  constructor(model, cache) {
    this.model = model
    this.cache = cache
  }

  async invoke(messages) {
    const cached = this.cache.get(messages)
    if (cached) return cached

    const result = await this.model.invoke(messages)
    this.cache.set(messages, result)
    return result
  }
}

// ── 2. 语义缓存（向量相似度）─────────────────────────────────
// 语义相近的问题（不完全相同）也能命中缓存
// "Vue3 的 ref 怎么用？" 和 "ref 在 Vue3 里怎么使用？" 命中同一条缓存
class SemanticCache {
  constructor(embeddings, { similarityThreshold = 0.92, ttl = 3600000 } = {}) {
    this.embeddings = embeddings
    this.threshold = similarityThreshold
    this.ttl = ttl
    this.entries = []   // [{ query, vector, response, createdAt }]
    this.stats = { hits: 0, misses: 0 }
  }

  cosineSim(a, b) {
    let dot = 0, na = 0, nb = 0
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb))
  }

  // 清理过期条目
  evict() {
    const now = Date.now()
    this.entries = this.entries.filter(e => now - e.createdAt < this.ttl)
  }

  async get(query) {
    this.evict()
    if (!this.entries.length) { this.stats.misses++; return null }

    const queryVec = await this.embeddings.embedQuery(query)

    let bestSim = 0, bestEntry = null
    for (const entry of this.entries) {
      const sim = this.cosineSim(queryVec, entry.vector)
      if (sim > bestSim) { bestSim = sim; bestEntry = entry }
    }

    if (bestSim >= this.threshold) {
      this.stats.hits++
      console.log(`  [语义缓存命中] 相似度 ${bestSim.toFixed(4)}，原始查询: ${bestEntry.query.slice(0, 40)}`)
      return bestEntry.response
    }

    this.stats.misses++
    return null
  }

  async set(query, response) {
    const vector = await this.embeddings.embedQuery(query)
    this.entries.push({ query, vector, response, createdAt: Date.now() })
  }
}

// ── 3. 分级缓存（L1 精确 → L2 语义 → L3 API）────────────────
class TieredCache {
  constructor(model, embeddings) {
    this.model = model
    this.l1 = new ExactCache({ ttl: 1800000 })        // 30 分钟
    this.l2 = new SemanticCache(embeddings, { similarityThreshold: 0.93, ttl: 3600000 })
    this.callCount = 0
    this.savedCalls = 0
  }

  async invoke(userMessage, systemPrompt = '') {
    const messages = [
      ...(systemPrompt ? [new SystemMessage(systemPrompt)] : []),
      new HumanMessage(userMessage),
    ]

    // L1：精确缓存
    const l1Result = this.l1.get(messages)
    if (l1Result) { this.savedCalls++; return l1Result.content }

    // L2：语义缓存（只对固定 system 的场景有效）
    const l2Result = await this.l2.get(userMessage)
    if (l2Result) {
      this.l1.set(messages, { content: l2Result })
      this.savedCalls++
      return l2Result
    }

    // L3：真实 API 调用
    console.log(`  [API调用] ${userMessage.slice(0, 40)}...`)
    this.callCount++
    const result = await this.model.invoke(messages)

    // 写入两级缓存
    this.l1.set(messages, result)
    await this.l2.set(userMessage, result.content)

    return result.content
  }

  get stats() {
    return {
      apiCalls: this.callCount,
      cachedCalls: this.savedCalls,
      l1HitRate: `${this.l1.hitRate}%`,
      totalSaved: `${this.savedCalls} 次 API 调用`,
    }
  }
}

// ── 测试 ─────────────────────────────────────────────────────
async function testCache() {
  console.log('=== 缓存策略测试 ===\n')

  // 测试精确缓存
  const exactCache = new ExactCache()
  const cachedModel = new CachedModel(model, exactCache)
  const msgs = [new HumanMessage('什么是 Vue3 的响应式系统？')]

  console.log('--- 精确缓存 ---')
  const r1 = await cachedModel.invoke(msgs)   // 第一次：调 API
  const r2 = await cachedModel.invoke(msgs)   // 第二次：命中缓存
  console.log('两次结果相同：', r1.content === r2.content)
  console.log('命中率：', exactCache.hitRate + '%')

  // 测试分级缓存（需要 OpenAI Embedding）
  if (process.env.OPENAI_API_KEY) {
    const embeddings = new OpenAIEmbeddings({
      model: 'text-embedding-3-small',
      apiKey: process.env.OPENAI_API_KEY,
    })

    const tieredCache = new TieredCache(model, embeddings)
    console.log('\n--- 分级缓存 ---')

    await tieredCache.invoke('Vue3 的 ref 是什么？')
    await tieredCache.invoke('Vue3 的 ref 是什么？')            // L1 命中
    await tieredCache.invoke('ref 在 Vue3 里怎么用？')           // L2 语义命中
    await tieredCache.invoke('Vue3 里的 reactive 怎么用？')      // L1+L2 都未命中，调 API

    console.log('\n缓存统计：', tieredCache.stats)
  }
}

// ── 4. 响应缓存中间件（Express）──────────────────────────────
export function createCacheMiddleware(cache) {
  return async (req, res, next) => {
    const { message, systemPrompt } = req.body
    const cacheKey = crypto
      .createHash('md5')
      .update(`${systemPrompt || ''}:${message}`)
      .digest('hex')

    const cached = req.app.locals.responseCache?.get(cacheKey)
    if (cached) {
      return res.json({ ...cached, fromCache: true })
    }

    // 把 cacheKey 挂到 req 上，路由处理完后在 res.json 里写入缓存
    req.cacheKey = cacheKey
    next()
  }
}

await testCache()
