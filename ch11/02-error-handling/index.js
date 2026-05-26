// 02-error-handling/index.js
// 生产级错误处理：分类、重试、降级、用户友好提示
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage } from '@langchain/core/messages'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0,
})

// ── 错误分类 ──────────────────────────────────────────────────
class AppError extends Error {
  constructor(message, { code, statusCode = 500, retryable = false, userMessage } = {}) {
    super(message)
    this.code = code
    this.statusCode = statusCode
    this.retryable = retryable
    this.userMessage = userMessage || '服务暂时不可用，请稍后重试'
    this.timestamp = new Date().toISOString()
  }
}

// 把 API 错误转成应用错误
function classifyApiError(err) {
  const status = err.status || err.statusCode

  if (status === 429) return new AppError('API 限流', {
    code: 'RATE_LIMIT',
    statusCode: 429,
    retryable: true,
    userMessage: '当前请求量较大，请稍后重试',
  })

  if (status === 401 || status === 403) return new AppError('API 认证失败', {
    code: 'AUTH_ERROR',
    statusCode: 500,
    retryable: false,
    userMessage: '服务配置错误，请联系管理员',
  })

  if (status === 400) return new AppError('请求参数错误', {
    code: 'BAD_REQUEST',
    statusCode: 400,
    retryable: false,
    userMessage: '输入内容有误，请检查后重试',
  })

  if (status >= 500 || err.message?.includes('network') || err.message?.includes('ECONNRESET')) {
    return new AppError('API 服务不可用', {
      code: 'SERVICE_UNAVAILABLE',
      statusCode: 503,
      retryable: true,
      userMessage: '服务暂时不可用，正在自动重试',
    })
  }

  if (err.message?.includes('timeout') || err.message?.includes('ETIMEDOUT')) {
    return new AppError('请求超时', {
      code: 'TIMEOUT',
      statusCode: 504,
      retryable: true,
      userMessage: '响应超时，请稍后重试',
    })
  }

  return new AppError(err.message, { code: 'UNKNOWN', retryable: false })
}

// ── 指数退避重试 ──────────────────────────────────────────────
async function withRetry(fn, { maxRetries = 3, baseDelay = 1000, onRetry } = {}) {
  let lastError

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (rawErr) {
      lastError = classifyApiError(rawErr)

      if (!lastError.retryable || attempt === maxRetries) throw lastError

      const delay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 300, 30000)
      onRetry?.({ attempt: attempt + 1, error: lastError, delay })
      await new Promise(r => setTimeout(r, delay))
    }
  }

  throw lastError
}

// ── 降级策略 ──────────────────────────────────────────────────
class FallbackChain {
  constructor() {
    // 主模型 → 备用模型 → 简化模型 → 静态兜底
    this.handlers = []
  }

  use(handler) { this.handlers.push(handler); return this }

  async execute(input) {
    for (let i = 0; i < this.handlers.length; i++) {
      try {
        const result = await this.handlers[i](input)
        if (i > 0) console.log(`  [降级] 使用了第 ${i + 1} 个降级方案`)
        return result
      } catch (err) {
        const appErr = classifyApiError(err)
        console.warn(`  [降级] 方案 ${i + 1} 失败：${appErr.code}`)

        if (i === this.handlers.length - 1) throw appErr
        // 不可重试的错误（如认证失败）直接抛出，不走降级
        if (!appErr.retryable) throw appErr
      }
    }
  }
}

// ── Express 错误处理中间件 ────────────────────────────────────
export function errorMiddleware(err, req, res, next) {
  const appErr = err instanceof AppError ? err : classifyApiError(err)

  // 记录日志（生产用结构化日志）
  const logEntry = {
    level: appErr.statusCode >= 500 ? 'error' : 'warn',
    code: appErr.code,
    message: appErr.message,
    statusCode: appErr.statusCode,
    path: req.path,
    method: req.method,
    timestamp: appErr.timestamp,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  }
  console.error(JSON.stringify(logEntry))

  // 返回用户友好的错误信息（不暴露内部细节）
  res.status(appErr.statusCode).json({
    error: {
      code: appErr.code,
      message: appErr.userMessage,
      retryable: appErr.retryable,
      ...(appErr.retryable && { retryAfter: 3 }),
    },
  })
}

// ── SSE 流式错误处理 ──────────────────────────────────────────
export function createSseErrorHandler(res) {
  return (err) => {
    const appErr = err instanceof AppError ? err : classifyApiError(err)

    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream')
    }

    res.write(`event: error\ndata: ${JSON.stringify({
      code: appErr.code,
      message: appErr.userMessage,
      retryable: appErr.retryable,
    })}\n\n`)

    res.end()
  }
}

// ── 测试 ─────────────────────────────────────────────────────
async function testErrorHandling() {
  console.log('=== 错误处理测试 ===\n')

  // 测试重试
  console.log('--- 指数退避重试 ---')
  let retryCount = 0
  try {
    await withRetry(
      async () => {
        retryCount++
        if (retryCount < 3) throw { status: 503, message: 'Service unavailable' }
        return await model.invoke([new HumanMessage('什么是 Vue3？')])
      },
      {
        maxRetries: 3,
        onRetry: ({ attempt, delay }) => console.log(`  重试 ${attempt}，等待 ${delay.toFixed(0)}ms`),
      }
    )
    console.log('  最终成功，重试次数：', retryCount - 1)
  } catch (e) {
    console.log('  最终失败：', e.userMessage)
  }

  // 测试降级链
  console.log('\n--- 降级链 ---')
  const chain = new FallbackChain()
    .use(async (input) => {
      throw { status: 503, message: 'Primary failed' }
    })
    .use(async (input) => {
      // 备用：换个模型或简化请求
      const res = await model.invoke([new HumanMessage(input)])
      return res.content + ' (via fallback)'
    })
    .use(async () => '暂时无法回答，请稍后再试')  // 最终兜底

  const result = await chain.execute('什么是 Vue3？')
  console.log('  降级结果：', result.slice(0, 60))
}

await testErrorHandling()
