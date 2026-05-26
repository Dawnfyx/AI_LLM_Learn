// 04-health-monitor/index.js
// 健康检查 + 指标收集：Kubernetes readiness/liveness probe 标准实现
import 'dotenv/config'
import express from 'express'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage } from '@langchain/core/messages'

const app = express()

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0,
})

// ── 服务启动时间 ──────────────────────────────────────────────
const startTime = Date.now()

// ── 指标收集 ──────────────────────────────────────────────────
const metrics = {
  requests: { total: 0, success: 0, error: 0, latency: [] },
  tokens:   { input: 0, output: 0 },
  cache:    { hits: 0, misses: 0 },
  uptime:   () => Math.floor((Date.now() - startTime) / 1000),
}

function recordRequest(success, latencyMs) {
  metrics.requests.total++
  if (success) metrics.requests.success++
  else metrics.requests.error++
  metrics.requests.latency.push(latencyMs)
  if (metrics.requests.latency.length > 1000) metrics.requests.latency.shift()
}

function getP99(latencies) {
  if (!latencies.length) return 0
  const sorted = [...latencies].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length * 0.99)]
}

// ── 外部依赖健康检查 ──────────────────────────────────────────
async function checkRedis() {
  try {
    // 实际项目里：await redisClient.ping()
    await new Promise(r => setTimeout(r, 5))   // 模拟
    return { status: 'healthy', latency: 5 }
  } catch (e) {
    return { status: 'unhealthy', error: e.message }
  }
}

async function checkDatabase() {
  try {
    // 实际项目里：await db.query('SELECT 1')
    await new Promise(r => setTimeout(r, 10))
    return { status: 'healthy', latency: 10 }
  } catch (e) {
    return { status: 'unhealthy', error: e.message }
  }
}

async function checkAiApi() {
  const start = Date.now()
  try {
    // 用最简单的请求测试 API 连通性
    await model.invoke([new HumanMessage('hi')], { maxTokens: 5 })
    return { status: 'healthy', latency: Date.now() - start }
  } catch (e) {
    return { status: 'unhealthy', error: e.message, latency: Date.now() - start }
  }
}

// ── 健康检查端点 ──────────────────────────────────────────────

// Liveness probe：服务是否还活着（崩溃/死锁 → 重启 Pod）
// 只检查进程状态，不检查外部依赖
app.get('/health/live', (req, res) => {
  res.json({
    status: 'ok',
    uptime: metrics.uptime(),
    timestamp: new Date().toISOString(),
  })
})

// Readiness probe：服务是否准备好接收流量
// 检查所有外部依赖，任一失败则返回 503，K8s 停止向此 Pod 路由
app.get('/health/ready', async (req, res) => {
  const [redis, db] = await Promise.all([checkRedis(), checkDatabase()])

  const allHealthy = redis.status === 'healthy' && db.status === 'healthy'

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'ready' : 'not-ready',
    checks: { redis, database: db },
    timestamp: new Date().toISOString(),
  })
})

// 详细健康状态（供监控系统和人工排查用）
app.get('/health', async (req, res) => {
  const [redis, db, aiApi] = await Promise.all([
    checkRedis(), checkDatabase(), checkAiApi(),
  ])

  const healthy = [redis, db, aiApi].every(c => c.status === 'healthy')
  const latencies = metrics.requests.latency

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'degraded',
    uptime: metrics.uptime(),
    version: process.env.APP_VERSION || '1.0.0',
    nodeVersion: process.version,
    checks: {
      redis,
      database: db,
      aiApi,
    },
    metrics: {
      requests: {
        total: metrics.requests.total,
        success: metrics.requests.success,
        error: metrics.requests.error,
        errorRate: metrics.requests.total
          ? `${(metrics.requests.error / metrics.requests.total * 100).toFixed(1)}%`
          : '0%',
        p99LatencyMs: getP99(latencies),
        avgLatencyMs: latencies.length
          ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
          : 0,
      },
      tokens: {
        totalInput: metrics.tokens.input,
        totalOutput: metrics.tokens.output,
      },
      cache: {
        hits: metrics.cache.hits,
        misses: metrics.cache.misses,
        hitRate: (metrics.cache.hits + metrics.cache.misses)
          ? `${(metrics.cache.hits / (metrics.cache.hits + metrics.cache.misses) * 100).toFixed(1)}%`
          : '0%',
      },
      memory: {
        heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
      },
    },
    timestamp: new Date().toISOString(),
  })
})

// Prometheus 格式指标（供 Prometheus 抓取）
app.get('/metrics', (req, res) => {
  const latencies = metrics.requests.latency
  const avg = latencies.length
    ? latencies.reduce((a, b) => a + b, 0) / latencies.length
    : 0

  const output = [
    `# HELP http_requests_total Total HTTP requests`,
    `# TYPE http_requests_total counter`,
    `http_requests_total{status="success"} ${metrics.requests.success}`,
    `http_requests_total{status="error"} ${metrics.requests.error}`,
    ``,
    `# HELP http_request_duration_ms HTTP request duration`,
    `# TYPE http_request_duration_ms gauge`,
    `http_request_duration_ms{quantile="0.99"} ${getP99(latencies)}`,
    `http_request_duration_ms{quantile="avg"} ${avg.toFixed(1)}`,
    ``,
    `# HELP ai_tokens_total Total AI tokens used`,
    `# TYPE ai_tokens_total counter`,
    `ai_tokens_total{type="input"} ${metrics.tokens.input}`,
    `ai_tokens_total{type="output"} ${metrics.tokens.output}`,
    ``,
    `# HELP cache_requests_total Cache requests`,
    `# TYPE cache_requests_total counter`,
    `cache_requests_total{result="hit"} ${metrics.cache.hits}`,
    `cache_requests_total{result="miss"} ${metrics.cache.misses}`,
    ``,
    `# HELP process_uptime_seconds Process uptime in seconds`,
    `# TYPE process_uptime_seconds gauge`,
    `process_uptime_seconds ${metrics.uptime()}`,
  ].join('\n')

  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.send(output)
})

// 模拟一些请求生成指标数据
for (let i = 0; i < 20; i++) {
  const latency = 100 + Math.random() * 400
  recordRequest(Math.random() > 0.05, latency)
}
metrics.tokens.input  = 12500
metrics.tokens.output = 8300
metrics.cache.hits    = 45
metrics.cache.misses  = 32

app.listen(3001, async () => {
  console.log('健康检查服务：http://localhost:3001')
  console.log('端点：')
  console.log('  GET /health/live  — Liveness probe')
  console.log('  GET /health/ready — Readiness probe')
  console.log('  GET /health       — 详细健康状态')
  console.log('  GET /metrics      — Prometheus 指标')
})
