// 03-rate-limit-queue/index.js
// 请求限流、队列、并发控制：避免超出 API 限制，平滑流量
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage } from '@langchain/core/messages'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0,
})

// ── 1. 令牌桶限流（Token Bucket）────────────────────────────
// 最常见的限流算法：以固定速率补充令牌，请求消耗令牌
class TokenBucket {
  constructor({ capacity = 10, refillRate = 2 } = {}) {
    this.capacity = capacity     // 桶的最大容量
    this.refillRate = refillRate // 每秒补充的令牌数
    this.tokens = capacity       // 当前令牌数
    this.lastRefill = Date.now()
  }

  refill() {
    const now = Date.now()
    const elapsed = (now - this.lastRefill) / 1000
    const newTokens = elapsed * this.refillRate
    this.tokens = Math.min(this.capacity, this.tokens + newTokens)
    this.lastRefill = now
  }

  async acquire(cost = 1) {
    this.refill()

    if (this.tokens >= cost) {
      this.tokens -= cost
      return true
    }

    // 计算需要等待多久
    const waitMs = ((cost - this.tokens) / this.refillRate) * 1000
    console.log(`  [限流] 等待 ${waitMs.toFixed(0)}ms`)
    await new Promise(r => setTimeout(r, waitMs))

    this.refill()
    this.tokens -= cost
    return true
  }
}

// ── 2. 优先级队列 ─────────────────────────────────────────────
// 不同业务优先级的请求，高优先级的先处理
class PriorityQueue {
  constructor({ concurrency = 3, rateLimit } = {}) {
    this.concurrency = concurrency
    this.rateLimit = rateLimit   // TokenBucket 实例
    this.queues = {
      high:   [],   // 优先级 1（最高）
      normal: [],   // 优先级 2
      low:    [],   // 优先级 3（最低）
    }
    this.running = 0
    this.stats = { high: 0, normal: 0, low: 0, total: 0 }
  }

  enqueue(fn, priority = 'normal') {
    return new Promise((resolve, reject) => {
      this.queues[priority].push({ fn, resolve, reject })
      this.stats[priority]++
      this.drain()
    })
  }

  // 从队列取下一个任务（高优先级优先）
  dequeue() {
    for (const level of ['high', 'normal', 'low']) {
      if (this.queues[level].length) return this.queues[level].shift()
    }
    return null
  }

  get pending() {
    return Object.values(this.queues).reduce((s, q) => s + q.length, 0)
  }

  async drain() {
    while (this.running < this.concurrency && this.pending > 0) {
      const task = this.dequeue()
      if (!task) break

      this.running++
      this.stats.total++

      // 限流：每个请求都要先获取令牌
      if (this.rateLimit) await this.rateLimit.acquire()

      task.fn()
        .then(task.resolve)
        .catch(task.reject)
        .finally(() => {
          this.running--
          this.drain()   // 任务完成后继续处理队列
        })
    }
  }
}

// ── 3. 指数退避重试 ───────────────────────────────────────────
// API 返回 429（限流）或 5xx 时自动重试，等待时间指数增长
async function withRetry(fn, {
  maxRetries = 3,
  baseDelay = 1000,    // 初始等待 1s
  maxDelay = 30000,    // 最多等待 30s
  shouldRetry = (err) => err.status === 429 || err.status >= 500,
} = {}) {
  let lastError

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err

      if (attempt === maxRetries || !shouldRetry(err)) throw err

      // 指数退避：1s, 2s, 4s...  + 随机抖动（避免惊群效应）
      const delay = Math.min(baseDelay * Math.pow(2, attempt) + Math.random() * 500, maxDelay)
      console.log(`  [重试] 第 ${attempt + 1} 次失败 (${err.message})，等待 ${delay.toFixed(0)}ms`)
      await new Promise(r => setTimeout(r, delay))
    }
  }

  throw lastError
}

// ── 4. 并发控制器 ─────────────────────────────────────────────
// 控制同时进行的 API 请求数，避免触发限流
class ConcurrencyController {
  constructor(maxConcurrent = 5) {
    this.max = maxConcurrent
    this.running = 0
    this.queue = []
  }

  async run(fn) {
    // 等待空槽
    if (this.running >= this.max) {
      await new Promise(resolve => this.queue.push(resolve))
    }

    this.running++
    try {
      return await fn()
    } finally {
      this.running--
      // 释放等待的任务
      if (this.queue.length > 0) {
        const next = this.queue.shift()
        next()
      }
    }
  }

  // 批量处理，自动控制并发
  async batch(items, fn) {
    return Promise.all(items.map(item => this.run(() => fn(item))))
  }
}

// ── 5. 测试 ───────────────────────────────────────────────────
async function testRateLimit() {
  console.log('=== 限流和队列测试 ===\n')

  // 测试令牌桶
  console.log('--- 令牌桶限流 ---')
  const bucket = new TokenBucket({ capacity: 3, refillRate: 1 })

  for (let i = 1; i <= 5; i++) {
    const start = Date.now()
    await bucket.acquire()
    console.log(`  请求 ${i}: 等待 ${Date.now() - start}ms`)
  }

  // 测试优先级队列
  console.log('\n--- 优先级队列 ---')
  const queue = new PriorityQueue({
    concurrency: 2,
    rateLimit: new TokenBucket({ capacity: 5, refillRate: 3 }),
  })

  const tasks = [
    { id: 1, priority: 'low',    msg: '低优先级任务 1' },
    { id: 2, priority: 'high',   msg: '高优先级任务' },
    { id: 3, priority: 'normal', msg: '普通任务' },
    { id: 4, priority: 'low',    msg: '低优先级任务 2' },
    { id: 5, priority: 'high',   msg: '高优先级任务 2' },
  ]

  const results = await Promise.all(
    tasks.map(t =>
      queue.enqueue(async () => {
        const res = await model.invoke([new HumanMessage(t.msg + '：用一句话回答什么是前端')])
        console.log(`  [${t.priority}] 任务${t.id} 完成`)
        return res.content.slice(0, 30)
      }, t.priority)
    )
  )

  console.log('\n队列统计：', queue.stats)
  console.log('所有任务已完成，优先级高的先执行')

  // 测试并发控制
  console.log('\n--- 并发控制（最多3个同时）---')
  const controller = new ConcurrencyController(3)
  const questions = Array.from({ length: 6 }, (_, i) => `问题${i + 1}：Vue3 特性`)

  const start = Date.now()
  await controller.batch(questions, async (q) => {
    return model.invoke([new HumanMessage(q)])
  })
  console.log(`6 个请求（并发 3）总耗时: ${Date.now() - start}ms`)
}

await testRateLimit()
