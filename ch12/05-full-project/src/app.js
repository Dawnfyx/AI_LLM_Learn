// 05-full-project/src/config.js
export const config = {
  app: {
    port: Number(process.env.PORT) || 3000,
    env: process.env.NODE_ENV || 'development',
    version: process.env.APP_VERSION || '1.0.0',
    allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173'],
  },
  ai: {
    models: {
      primary: process.env.PRIMARY_MODEL || 'deepseek-chat',
    },
    keys: { deepseek: process.env.DEEPSEEK_API_KEY },
    defaultSystemPrompt: '你是前端开发助手，回答简洁专业。',
  },
}

export function validateConfig() {
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error('缺少必填环境变量：DEEPSEEK_API_KEY')
  }
}

// ─────────────────────────────────────────────────────────────
// 05-full-project/src/utils/logger.js
class Logger {
  _log(level, msg, ctx = {}) {
    const entry = { timestamp: new Date().toISOString(), level, msg, ...ctx }
    if (process.env.NODE_ENV === 'production') {
      process.stdout.write(JSON.stringify(entry) + '\n')
    } else {
      const c = { error: '\x1b[31m', warn: '\x1b[33m', info: '\x1b[36m' }[level] || ''
      console.log(`${c}[${level.toUpperCase()}]\x1b[0m ${msg}`, Object.keys(ctx).length ? ctx : '')
    }
  }
  info(msg, ctx)  { this._log('info',  msg, ctx) }
  warn(msg, ctx)  { this._log('warn',  msg, ctx) }
  error(msg, ctx) { this._log('error', msg, ctx) }
}
export const logger = new Logger()

// ─────────────────────────────────────────────────────────────
// 05-full-project/src/services/cache.js
import crypto from 'crypto'
class ExactCache {
  constructor() { this.store = new Map(); this.stats = { hits: 0, misses: 0 } }
  _key(s, m) { return crypto.createHash('md5').update(`${s}|${m}`).digest('hex') }
  get(s, m) {
    const e = this.store.get(this._key(s, m))
    if (!e || Date.now() - e.ts > 1800000) { this.stats.misses++; return null }
    this.stats.hits++; return e
  }
  set(s, m, v) { this.store.set(this._key(s, m), { ...v, ts: Date.now() }) }
  get hitRate() { const t = this.stats.hits + this.stats.misses; return t ? `${(this.stats.hits/t*100).toFixed(1)}%` : '0%' }
}
export const cache = new ExactCache()

// ─────────────────────────────────────────────────────────────
// 05-full-project/src/services/cost.js
import { BaseCallbackHandler } from '@langchain/core/callbacks/base'
class CostTracker extends BaseCallbackHandler {
  name = 'CostTracker'
  constructor() { super(); this.total = { calls: 0, usd: 0 } }
  handleLLMEnd(output) {
    const u = output.llmOutput?.tokenUsage
    if (!u) return
    const cost = (u.inputTokens/1e6*0.27) + (u.outputTokens/1e6*1.10)
    this.total.calls++; this.total.usd += cost
  }
  getStats() { return { ...this.total, cny: this.total.usd * 7.2 } }
}
export const costTracker = new CostTracker()

// ─────────────────────────────────────────────────────────────
// 05-full-project/src/middleware/validate.js
import { z } from 'zod'
const Schema = z.object({
  message: z.string().min(1, '消息不能为空').max(4000, '消息过长').trim(),
  sessionId: z.string().optional(),
  systemPrompt: z.string().max(2000).optional(),
})
export function validateInput(req, res, next) {
  const result = Schema.safeParse(req.body)
  if (!result.success) return res.status(400).json({ error: result.error.errors[0].message })
  req.body = result.data
  next()
}

// ─────────────────────────────────────────────────────────────
// 05-full-project/src/middleware/rateLimit.js
class TokenBucket {
  constructor() { this.tokens = 20; this.last = Date.now() }
  consume() {
    const e = (Date.now() - this.last) / 1000
    this.tokens = Math.min(20, this.tokens + e * 5)
    this.last = Date.now()
    if (this.tokens >= 1) { this.tokens--; return true }
    return false
  }
}
const bucket = new TokenBucket()
export function rateLimiter(req, res, next) {
  if (!bucket.consume()) return res.status(429).json({ error: '请求太频繁，请稍后重试' })
  next()
}

// ─────────────────────────────────────────────────────────────
// 05-full-project/src/middleware/security.js
const INJECTION_PATTERNS = [/ignore\s+previous\s+instructions?/i, /忽略.*指令/, /你现在是/, /act as/i]
export function securityCheck(req, res, next) {
  const msg = req.body.message || ''
  if (INJECTION_PATTERNS.some(p => p.test(msg))) {
    return res.status(400).json({ error: '输入内容不符合要求' })
  }
  next()
}

// ─────────────────────────────────────────────────────────────
// 05-full-project/src/middleware/error.js
export function errorMiddleware(err, req, res, next) {
  console.error(JSON.stringify({ level: 'error', traceId: req.traceId, error: err.message, ts: new Date().toISOString() }))
  res.status(err.statusCode || 500).json({ error: err.userMessage || '服务内部错误' })
}

// ─────────────────────────────────────────────────────────────
// 05-full-project/src/routes/health.js
import express from 'express'
const startTime = Date.now()
export const healthRouter = express.Router()
healthRouter.get('/live',  (req, res) => res.json({ status: 'ok', uptime: Math.floor((Date.now()-startTime)/1000) }))
healthRouter.get('/ready', (req, res) => res.json({ status: 'ready' }))
healthRouter.get('/', (req, res) => res.json({ status: 'healthy', cache: cache.hitRate, cost: costTracker.getStats() }))

// ─────────────────────────────────────────────────────────────
// 05-full-project/src/routes/knowledge.js
import express from 'express'
export const knowledgeRouter = express.Router()
knowledgeRouter.get('/', (req, res) => res.json({ message: 'RAG 知识库接口，参考第六章实现' }))
knowledgeRouter.post('/documents', (req, res) => res.json({ message: '文档上传，参考第六章实现' }))
