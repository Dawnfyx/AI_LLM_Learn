// 05-vue-perf-app/server.js
// 性能优化完整服务端：缓存 + 限流 + 成本监控 + 流式
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import crypto from 'crypto'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { BaseCallbackHandler } from '@langchain/core/callbacks/base'

const app = express()
app.use(cors())
app.use(express.json())

// ── 定价 ──────────────────────────────────────────────────────
const PRICING = {
  'deepseek-chat': { input: 0.27, output: 1.10 },
}

function calcCost(inputT, outputT, model = 'deepseek-chat') {
  const p = PRICING[model] || PRICING['deepseek-chat']
  return {
    usd: (inputT / 1e6) * p.input + (outputT / 1e6) * p.output,
    cny: ((inputT / 1e6) * p.input + (outputT / 1e6) * p.output) * 7.2,
  }
}

// ── 精确缓存 ──────────────────────────────────────────────────
class ExactCache {
  constructor(ttl = 1800000) {
    this.cache = new Map()
    this.ttl = ttl
    this.stats = { hits: 0, misses: 0, saved: 0 }
  }

  key(sys, msg) {
    return crypto.createHash('md5').update(`${sys}:${msg}`).digest('hex')
  }

  get(sys, msg) {
    const k = this.key(sys, msg)
    const e = this.cache.get(k)
    if (!e || Date.now() - e.ts > this.ttl) { this.stats.misses++; return null }
    this.stats.hits++
    this.stats.saved += e.cost?.usd || 0
    return e
  }

  set(sys, msg, data) {
    this.cache.set(this.key(sys, msg), { ...data, ts: Date.now() })
  }

  get hitRate() {
    const t = this.stats.hits + this.stats.misses
    return t ? `${(this.stats.hits / t * 100).toFixed(1)}%` : '0%'
  }
}

// ── 令牌桶限流 ────────────────────────────────────────────────
class TokenBucket {
  constructor(capacity = 20, refillRate = 5) {
    this.capacity = capacity
    this.refillRate = refillRate
    this.tokens = capacity
    this.lastRefill = Date.now()
  }

  refill() {
    const elapsed = (Date.now() - this.lastRefill) / 1000
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRate)
    this.lastRefill = Date.now()
  }

  tryConsume(cost = 1) {
    this.refill()
    if (this.tokens >= cost) { this.tokens -= cost; return true }
    return false
  }

  waitMs(cost = 1) {
    this.refill()
    if (this.tokens >= cost) return 0
    return ((cost - this.tokens) / this.refillRate) * 1000
  }
}

// ── 成本追踪 ──────────────────────────────────────────────────
class CostTracker extends BaseCallbackHandler {
  name = 'CostTracker'
  constructor() {
    super()
    this.records = []
    this.total = { calls: 0, inputT: 0, outputT: 0, usd: 0 }
  }

  handleLLMEnd(output) {
    const usage = output.llmOutput?.tokenUsage
    if (!usage) return
    const { inputTokens: i, outputTokens: o } = usage
    const cost = calcCost(i, o)
    this.records.push({ time: new Date().toISOString(), inputT: i, outputT: o, ...cost })
    this.total.calls++
    this.total.inputT  += i
    this.total.outputT += o
    this.total.usd     += cost.usd
  }

  getStats() {
    return {
      calls: this.total.calls,
      tokens: this.total.inputT + this.total.outputT,
      costUSD: `$${this.total.usd.toFixed(6)}`,
      costCNY: `¥${(this.total.usd * 7.2).toFixed(4)}`,
      avgPerCall: `$${(this.total.usd / (this.total.calls || 1)).toFixed(6)}`,
      recentRecords: this.records.slice(-5),
    }
  }
}

// ── 全局单例 ──────────────────────────────────────────────────
const cache   = new ExactCache()
const bucket  = new TokenBucket(20, 5)
const tracker = new CostTracker()

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0.7,
  streaming: true,
  callbacks: [tracker],
})

// ── API：聊天（流式 + 缓存 + 限流）──────────────────────────
app.post('/api/chat/stream', async (req, res) => {
  const { message, systemPrompt = '你是前端助手，回答简洁专业。' } = req.body
  if (!message?.trim()) return res.status(400).json({ error: '消息不能为空' })

  // 限流检查
  const waitMs = bucket.waitMs()
  if (waitMs > 2000) {
    return res.status(429).json({ error: '请求太频繁，请稍后再试', waitMs })
  }
  if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs))
  bucket.tryConsume()

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const send = (event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  try {
    // 缓存检查
    const cached = cache.get(systemPrompt, message)
    if (cached) {
      send('cache_hit', { source: 'l1' })
      for (const char of cached.content) {
        send('token', { token: char })
        await new Promise(r => setTimeout(r, 5))
      }
      send('done', { fromCache: true, cost: { usd: 0, cny: 0 } })
      return res.end()
    }

    send('start', {})
    let fullReply = ''
    let inputT = 0, outputT = 0

    for await (const event of (await model.bindTools([]).stream([
      new SystemMessage(systemPrompt),
      new HumanMessage(message),
    ]))) {
      if (event.content) {
        fullReply += event.content
        send('token', { token: event.content })
      }
      if (event.usage_metadata) {
        inputT  = event.usage_metadata.input_tokens  || 0
        outputT = event.usage_metadata.output_tokens || 0
      }
    }

    const cost = calcCost(inputT, outputT)
    cache.set(systemPrompt, message, { content: fullReply, cost })
    send('done', { cost, fromCache: false })
  } catch (e) {
    send('error', { message: e.message })
  } finally {
    res.end()
  }
})

// ── API：监控数据 ─────────────────────────────────────────────
app.get('/api/monitor', (req, res) => {
  res.json({
    cache: {
      size: cache.cache.size,
      hitRate: cache.hitRate,
      totalSavedUSD: `$${cache.stats.saved.toFixed(6)}`,
      ...cache.stats,
    },
    rateLimiter: {
      currentTokens: bucket.tokens.toFixed(1),
      capacity: bucket.capacity,
      refillRate: `${bucket.refillRate}/s`,
    },
    cost: tracker.getStats(),
  })
})

app.get('/health', (req, res) => res.json({ status: 'ok' }))

app.listen(3000, () => console.log('性能优化服务已启动：http://localhost:3000'))
