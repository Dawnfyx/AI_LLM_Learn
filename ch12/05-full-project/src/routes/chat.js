// 05-full-project/src/routes/chat.js
// 对话路由：集成缓存、限流、记忆、流式输出
import express from 'express'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'
import { config } from '../config.js'
import { logger } from '../utils/logger.js'
import { validateInput } from '../middleware/validate.js'
import { rateLimiter } from '../middleware/rateLimit.js'
import { securityCheck } from '../middleware/security.js'
import { cache } from '../services/cache.js'
import { costTracker } from '../services/cost.js'

export const chatRouter = express.Router()

// 会话历史（生产用 Redis）
const sessionHistories = new Map()

// 模型实例（单例复用）
const model = new ChatOpenAI({
  model: config.ai.models.primary,
  apiKey: config.ai.keys.deepseek,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0.7,
  streaming: true,
  callbacks: [costTracker],
})

// ── POST /api/chat/stream ─────────────────────────────────────
chatRouter.post('/stream',
  rateLimiter,        // 限流
  validateInput,      // 输入校验
  securityCheck,      // 安全检查（注入检测）
  async (req, res) => {
    const { message, sessionId, systemPrompt = config.ai.defaultSystemPrompt } = req.body
    const traceId = req.traceId
    const sid = sessionId || `anon_${req.ip?.replace(/[:.]/g, '_')}`

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    const send = (event, data) => {
      if (!res.writableEnded) {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      }
    }

    try {
      // 缓存检查
      const cached = cache.get(systemPrompt, message)
      if (cached) {
        send('cache_hit', { source: 'l1' })
        // 模拟流式输出（从缓存读取）
        for (let i = 0; i < cached.content.length; i += 5) {
          send('token', { token: cached.content.slice(i, i + 5) })
          await new Promise(r => setTimeout(r, 5))
        }
        send('done', { fromCache: true })
        return res.end()
      }

      // 会话历史
      if (!sessionHistories.has(sid)) sessionHistories.set(sid, [])
      const history = sessionHistories.get(sid)

      // Token 感知截取：保留最近消息
      const trimmedHistory = history.slice(-8)  // 最近 4 轮

      send('start', { traceId })

      const messages = [
        new SystemMessage(systemPrompt),
        ...trimmedHistory,
        new HumanMessage(message),
      ]

      let fullReply = ''
      const stream = await model.stream(messages)

      for await (const chunk of stream) {
        if (chunk.content) {
          fullReply += chunk.content
          send('token', { token: chunk.content })
        }
      }

      // 更新历史
      history.push(new HumanMessage(message))
      history.push(new AIMessage(fullReply))
      // 防止历史无限增长
      if (history.length > 20) history.splice(0, 2)

      // 写入缓存
      cache.set(systemPrompt, message, { content: fullReply })

      send('done', { fromCache: false })
      logger.info('chat completed', { traceId, sessionId: sid, outputLen: fullReply.length })
    } catch (err) {
      logger.error('chat error', { traceId, error: err.message })
      send('error', { message: '服务暂时不可用，请稍后重试' })
    } finally {
      res.end()
    }
  }
)

// ── POST /api/chat/feedback ───────────────────────────────────
// 用户对回答的反馈（好评/差评），用于分析和改进
chatRouter.post('/feedback', validateInput, async (req, res) => {
  const { messageId, rating, comment } = req.body

  // 存入数据库（生产代码）
  logger.info('user feedback', {
    traceId: req.traceId,
    messageId, rating, comment: comment?.slice(0, 200),
  })

  res.json({ success: true })
})

// ── DELETE /api/chat/session/:id ─────────────────────────────
chatRouter.delete('/session/:id', (req, res) => {
  sessionHistories.delete(req.params.id)
  res.json({ success: true })
})
