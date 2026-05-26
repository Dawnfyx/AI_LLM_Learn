// 05-full-project/src/index.js
// 完整生产级应用入口：集成全书所有模块
import 'dotenv/config'
import express from 'express'
import helmet from 'helmet'
import compression from 'compression'
import cors from 'cors'
import { randomUUID } from 'crypto'

// ── 导入各模块 ────────────────────────────────────────────────
import { config, validateConfig } from './config.js'
import { logger } from './utils/logger.js'
import { chatRouter } from './routes/chat.js'
import { knowledgeRouter } from './routes/knowledge.js'
import { healthRouter } from './routes/health.js'
import { errorMiddleware } from './middleware/error.js'

// 启动时校验必填配置
validateConfig()

const app = express()

// ── 基础中间件 ────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }))
app.use(compression())
app.use(cors({
  origin: config.app.allowedOrigins,
  credentials: true,
}))
app.use(express.json({ limit: '2mb' }))

// 请求日志 + TraceId 注入
app.use((req, res, next) => {
  const traceId = req.headers['x-trace-id'] || randomUUID()
  req.traceId = traceId
  res.setHeader('X-Trace-Id', traceId)

  const start = Date.now()
  res.on('finish', () => {
    const level = res.statusCode >= 500 ? 'error'
                : res.statusCode >= 400 ? 'warn' : 'info'
    logger[level]('request', {
      traceId, method: req.method, path: req.path,
      status: res.statusCode, duration: Date.now() - start,
      ip: req.ip,
    })
  })
  next()
})

// ── 路由 ──────────────────────────────────────────────────────
app.use('/health', healthRouter)
app.use('/api/chat', chatRouter)
app.use('/api/knowledge', knowledgeRouter)

// 未匹配路由
app.use('*', (req, res) => {
  res.status(404).json({ error: '接口不存在' })
})

// 错误处理（最后注册）
app.use(errorMiddleware)

// ── 启动服务 ──────────────────────────────────────────────────
const server = app.listen(config.app.port, () => {
  logger.info('server started', {
    port: config.app.port,
    env: config.app.env,
    version: config.app.version,
    nodeVersion: process.version,
  })
})

// ── 优雅退出 ──────────────────────────────────────────────────
let isShuttingDown = false

async function shutdown(signal) {
  if (isShuttingDown) return
  isShuttingDown = true

  logger.info('shutdown signal received', { signal })

  // 停止接受新连接
  server.close()

  // 等待在途请求（最多 30s）
  await new Promise(r => setTimeout(r, Math.min(parseInt(process.env.GRACEFUL_TIMEOUT || '5000'), 30000)))

  logger.info('server stopped gracefully')
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT',  () => shutdown('SIGINT'))

process.on('uncaughtException', (err) => {
  logger.error('uncaught exception', { error: err.message, stack: err.stack })
  shutdown('uncaughtException')
})

process.on('unhandledRejection', (reason) => {
  logger.error('unhandled rejection', { reason: String(reason) })
})

export default app
