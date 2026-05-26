// 03-logging-tracing/index.js
// 结构化日志 + 链路追踪：生产环境必备，便于排查问题
import { randomUUID } from 'crypto'

// ── 结构化日志器 ──────────────────────────────────────────────
// 生产环境输出 JSON，方便 ELK/Grafana/Loki 收集分析
class Logger {
  constructor({ service, version, environment } = {}) {
    this.service = service || 'ai-app'
    this.version = version || '1.0.0'
    this.env = environment || process.env.NODE_ENV || 'development'
  }

  _log(level, message, context = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      version: this.version,
      environment: this.env,
      message,
      ...context,
    }

    // 生产输出 JSON，开发输出可读格式
    if (this.env === 'production') {
      process.stdout.write(JSON.stringify(entry) + '\n')
    } else {
      const levelColors = { error: '\x1b[31m', warn: '\x1b[33m', info: '\x1b[36m', debug: '\x1b[90m' }
      const color = levelColors[level] || ''
      const ts = entry.timestamp.slice(11, 19)
      const ctx = Object.keys(context).length ? ' ' + JSON.stringify(context) : ''
      console.log(`${color}[${ts}] ${level.toUpperCase()} ${message}${ctx}\x1b[0m`)
    }

    return entry
  }

  info(message, context)  { return this._log('info', message, context) }
  warn(message, context)  { return this._log('warn', message, context) }
  error(message, context) { return this._log('error', message, context) }
  debug(message, context) {
    if (this.env !== 'production') return this._log('debug', message, context)
  }
}

// ── 链路追踪 ─────────────────────────────────────────────────
// 为每个请求生成唯一 traceId，串联所有相关日志
class Tracer {
  constructor(logger) {
    this.logger = logger
    this.spans = new Map()   // traceId → 当前 span 信息
  }

  startTrace(operation, metadata = {}) {
    const traceId = randomUUID()
    const span = {
      traceId,
      operation,
      startTime: Date.now(),
      metadata,
      events: [],
    }
    this.spans.set(traceId, span)

    this.logger.info(`[TRACE START] ${operation}`, { traceId, ...metadata })
    return traceId
  }

  addEvent(traceId, event, data = {}) {
    const span = this.spans.get(traceId)
    if (!span) return

    const eventEntry = {
      event,
      elapsed: Date.now() - span.startTime,
      data,
    }
    span.events.push(eventEntry)

    this.logger.info(`[TRACE EVENT] ${event}`, { traceId, elapsed: eventEntry.elapsed, ...data })
  }

  endTrace(traceId, result = {}) {
    const span = this.spans.get(traceId)
    if (!span) return

    const duration = Date.now() - span.startTime
    this.spans.delete(traceId)

    this.logger.info(`[TRACE END] ${span.operation}`, {
      traceId,
      duration,
      events: span.events.length,
      ...result,
    })

    return { traceId, duration, events: span.events }
  }

  errorTrace(traceId, error) {
    const span = this.spans.get(traceId)
    if (!span) return

    const duration = Date.now() - span.startTime
    this.spans.delete(traceId)

    this.logger.error(`[TRACE ERROR] ${span.operation}`, {
      traceId,
      duration,
      errorCode: error.code || 'UNKNOWN',
      errorMessage: error.message,
    })
  }
}

// ── AI 调用日志 ────────────────────────────────────────────────
class AiCallLogger {
  constructor(logger, tracer) {
    this.logger = logger
    this.tracer = tracer
  }

  // 包装 AI 模型调用，自动记录日志
  async loggedInvoke(model, messages, options = {}) {
    const { traceId, feature = 'chat', userId } = options
    const callId = randomUUID()
    const start = Date.now()

    const inputPreview = messages
      .map(m => `${m._getType()}: ${(m.content || '').slice(0, 50)}`)
      .join(' | ')

    this.logger.info('AI call start', {
      callId, traceId, feature, userId,
      model: model.model || 'unknown',
      inputPreview,
      messageCount: messages.length,
    })

    if (traceId) this.tracer?.addEvent(traceId, 'ai_call_start', { callId, feature })

    try {
      const result = await model.invoke(messages)
      const duration = Date.now() - start

      const usage = result.usage_metadata || {}
      const cost = this._calcCost(usage.input_tokens, usage.output_tokens)

      this.logger.info('AI call success', {
        callId, traceId, duration,
        inputTokens: usage.input_tokens || 0,
        outputTokens: usage.output_tokens || 0,
        costUSD: cost,
        outputPreview: (result.content || '').slice(0, 50),
      })

      if (traceId) this.tracer?.addEvent(traceId, 'ai_call_end', {
        callId, duration, cost,
      })

      return result
    } catch (err) {
      const duration = Date.now() - start
      this.logger.error('AI call failed', {
        callId, traceId, duration,
        errorType: err.status ? `HTTP_${err.status}` : 'NETWORK',
        errorMessage: err.message,
      })
      throw err
    }
  }

  _calcCost(inputT = 0, outputT = 0) {
    return ((inputT / 1e6 * 0.27) + (outputT / 1e6 * 1.10)).toFixed(6)
  }
}

// ── Express 中间件：请求日志 + TraceId 注入 ──────────────────
export function requestLogger(logger) {
  return (req, res, next) => {
    const traceId = req.headers['x-trace-id'] || randomUUID()
    const start = Date.now()

    req.traceId = traceId
    res.setHeader('X-Trace-Id', traceId)   // 返回给客户端，方便排查

    res.on('finish', () => {
      const duration = Date.now() - start
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'
      logger[level]('HTTP request', {
        traceId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration,
        userAgent: req.headers['user-agent']?.slice(0, 50),
        ip: req.ip,
      })
    })

    next()
  }
}

// ── 测试 ─────────────────────────────────────────────────────
const logger = new Logger({ service: 'ai-demo', environment: 'development' })
const tracer = new Tracer(logger)

// 模拟一次完整的 RAG 请求链路
const traceId = tracer.startTrace('rag_query', { userId: 'user-001', feature: 'doc-qa' })

logger.info('用户问题接收', { traceId, question: 'Vue3 的响应式原理是什么？' })

tracer.addEvent(traceId, 'embedding_start', { model: 'text-embedding-3-small' })
await new Promise(r => setTimeout(r, 50))  // 模拟 embedding 时间
tracer.addEvent(traceId, 'embedding_done', { vectors: 1 })

tracer.addEvent(traceId, 'retrieval_start', { k: 3 })
await new Promise(r => setTimeout(r, 80))  // 模拟检索时间
tracer.addEvent(traceId, 'retrieval_done', { docsFound: 3, topScore: 0.87 })

tracer.addEvent(traceId, 'llm_start', { model: 'deepseek-chat' })
await new Promise(r => setTimeout(r, 300)) // 模拟 LLM 时间
tracer.addEvent(traceId, 'llm_done', { inputTokens: 450, outputTokens: 200, cost: '$0.000239' })

const traceResult = tracer.endTrace(traceId, { success: true, cached: false })
console.log('\n链路总耗时：', traceResult.duration + 'ms')
console.log('事件数量：', traceResult.events.length)
