// 06-vue-production-app/server.js
// 生产级完整应用服务端：集成本课程所有关键能力
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import { randomUUID } from 'crypto'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { BaseCallbackHandler } from '@langchain/core/callbacks/base'
import crypto from 'crypto'

const app = express()

// ── 基础中间件 ────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,   // 根据实际需求配置
  crossOriginEmbedderPolicy: false,
}))
app.use(compression())
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || '*' }))
app.use(express.json({ limit: '1mb' }))

// ── 简化版工具类（复用前几章的实现） ─────────────────────────

class ExactCache {
  constructor(ttl = 1800000) { this.cache = new Map(); this.ttl = ttl; this.stats = { hits: 0, misses: 0 } }
  key(s, m) { return crypto.createHash('md5').update(`${s}:${m}`).digest('hex') }
  get(s, m) {
    const e = this.cache.get(this.key(s, m))
    if (!e || Date.now() - e.ts > this.ttl) { this.stats.misses++; return null }
    this.stats.hits++; return e
  }
  set(s, m, v) { this.cache.set(this.key(s, m), { ...v, ts: Date.now() }) }
  get hitRate() { const t = this.stats.hits + this.stats.misses; return t ? `${(this.stats.hits / t * 100).toFixed(1)}%` : '0%' }
}

class TokenBucket {
  constructor(cap = 20, rate = 5) { this.cap = cap; this.rate = rate; this.tokens = cap; this.last = Date.now() }
  refill() { const e = (Date.now() - this.last) / 1000; this.tokens = Math.min(this.cap, this.tokens + e * this.rate); this.last = Date.now() }
  tryConsume() { this.refill(); if (this.tokens >= 1) { this.tokens--; return true } return false }
  waitMs() { this.refill(); return this.tokens >= 1 ? 0 : ((1 - this.tokens) / this.rate) * 1000 }
}

class Logger {
  info(msg, ctx = {})  { console.log(JSON.stringify({ level: 'info',  time: new Date().toISOString(), msg, ...ctx })) }
  warn(msg, ctx = {})  { console.warn(JSON.stringify({ level: 'warn',  time: new Date().toISOString(), msg, ...ctx })) }
  error(msg, ctx = {}) { console.error(JSON.stringify({ level: 'error', time: new Date().toISOString(), msg, ...ctx })) }
}

class CostTracker extends BaseCallbackHandler {
  name = 'CostTracker'
  constructor() { super(); this.total = { calls: 0, usd: 0, inputT: 0, outputT: 0 } }
  handleLLMEnd(output) {
    const u = output.llmOutput?.tokenUsage
    if (!u) return
    const cost = (u.inputTokens / 1e6 * 0.27) + (u.outputTokens / 1e6 * 1.10)
    this.total.calls++; this.total.usd += cost; this.total.inputT += u.inputTokens; this.total.outputT += u.outputTokens
  }
  getStats() { return { ...this.total, costCNY: this.total.usd * 7.2 } }
}

// ── 全局实例 ──────────────────────────────────────────────────
const cache   = new ExactCache()
const bucket  = new TokenBucket()
const logger  = new Logger()
const tracker = new CostTracker()
const startTime = Date.now()
const sessionHistories = new Map()

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0.7,
  streaming: true,
  callbacks: [tracker],
})

// ── 请求日志中间件 ────────────────────────────────────────────
app.use((req, res, next) => {
  const traceId = req.headers['x-trace-id'] || randomUUID()
  req.traceId = traceId
  res.setHeader('X-Trace-Id', traceId)
  const start = Date.now()
  res.on('finish', () => {
    logger.info('request', {
      traceId, method: req.method, path: req.path,
      status: res.statusCode, duration: Date.now() - start,
    })
  })
  next()
})

// ── 聊天 API ──────────────────────────────────────────────────
app.post('/api/chat/stream', async (req, res) => {
  const { message, sessionId, systemPrompt = '你是前端开发助手，回答简洁专业。' } = req.body

  if (!message?.trim()) return res.status(400).json({ error: '消息不能为空' })
  if (message.length > 4000) return res.status(400).json({ error: '消息过长' })

  // 限流
  const waitMs = bucket.waitMs()
  if (waitMs > 3000) return res.status(429).json({ error: '请求太频繁', retryAfter: 3 })
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
      send('cache_hit', {})
      for (const char of cached.content) {
        send('token', { token: char })
        await new Promise(r => setTimeout(r, 8))
      }
      send('done', { fromCache: true })
      return res.end()
    }

    // 会话历史
    const sid = sessionId || `anon_${req.ip}`
    if (!sessionHistories.has(sid)) sessionHistories.set(sid, [])
    const history = sessionHistories.get(sid)

    history.push(new HumanMessage(message))
    if (history.length > 12) history.splice(0, 2)

    send('start', { traceId: req.traceId })

    let fullReply = ''
    const stream = await model.stream([
      new SystemMessage(systemPrompt),
      ...history.slice(-6),
    ])

    for await (const chunk of stream) {
      if (chunk.content) {
        fullReply += chunk.content
        send('token', { token: chunk.content })
      }
    }

    history.push({ _getType: () => 'ai', content: fullReply })
    cache.set(systemPrompt, message, { content: fullReply })

    send('done', { fromCache: false })
    logger.info('chat completed', { traceId: req.traceId, outputLen: fullReply.length })
  } catch (err) {
    logger.error('chat error', { traceId: req.traceId, error: err.message })
    send('error', { message: '服务暂时不可用，请稍后重试' })
  } finally {
    res.end()
  }
})

// ── 健康检查 ──────────────────────────────────────────────────
app.get('/health/live', (req, res) => {
  res.json({ status: 'ok', uptime: Math.floor((Date.now() - startTime) / 1000) })
})

app.get('/health/ready', (req, res) => {
  res.json({ status: 'ready', timestamp: new Date().toISOString() })
})

app.get('/health', (req, res) => {
  const mem = process.memoryUsage()
  res.json({
    status: 'healthy',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version: process.env.APP_VERSION || '1.0.0',
    cache: { size: cache.cache.size, hitRate: cache.hitRate, ...cache.stats },
    cost: tracker.getStats(),
    memory: {
      heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
    },
    sessions: sessionHistories.size,
  })
})

// ── 错误中间件 ────────────────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error('unhandled error', { traceId: req.traceId, error: err.message })
  res.status(500).json({ error: '服务内部错误' })
})

// ── 优雅退出 ──────────────────────────────────────────────────
async function shutdown() {
  console.log('\n收到退出信号，正在优雅关闭...')
  // 等待进行中的请求完成（最多 30s）
  await new Promise(r => setTimeout(r, 2000))
  console.log('服务已关闭')
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  logger.info('server started', { port: PORT, env: process.env.NODE_ENV || 'development' })
})
