// 06-vue-memory-app/server.js
// 完整长期记忆应用服务端：
// - 跨会话记忆持久化（文件存储，可替换为 MySQL）
// - 记忆自动提取
// - 个性化对话
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import fs from 'fs/promises'
import path from 'path'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'
import { InMemoryChatMessageHistory } from '@langchain/core/chat_history'
import { z } from 'zod'

const app = express()
app.use(cors())
app.use(express.json())

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0.7,
  streaming: true,
})

const DATA_DIR = './data'

// ── 简单的文件存储（生产换数据库）────────────────────────────
async function loadUserData(userId) {
  const filePath = path.join(DATA_DIR, `${userId}.json`)
  try {
    const data = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(data)
  } catch {
    return {
      userId,
      name: null,
      memories: [],          // 长期记忆片段
      sessionCount: 0,
      createdAt: new Date().toISOString(),
    }
  }
}

async function saveUserData(userId, data) {
  await fs.mkdir(DATA_DIR, { recursive: true })
  const filePath = path.join(DATA_DIR, `${userId}.json`)
  await fs.writeFile(filePath, JSON.stringify(data, null, 2))
}

// ── 会话存储（内存，不需要跨重启持久化）──────────────────────
const sessionHistories = new Map()

function getSessionHistory(sessionId) {
  if (!sessionHistories.has(sessionId)) {
    sessionHistories.set(sessionId, new InMemoryChatMessageHistory())
  }
  return sessionHistories.get(sessionId)
}

// ── 记忆提取 ─────────────────────────────────────────────────
const MemorySchema = z.object({
  memories: z.array(z.object({
    content: z.string(),
    category: z.enum(['preference', 'fact', 'goal', 'event']),
    importance: z.number().min(1).max(5),
    tags: z.array(z.string()),
  })),
})

async function extractMemories(userMsg, assistantMsg) {
  try {
    const extractModel = model.withStructuredOutput(MemorySchema)
    const result = await extractModel.invoke([
      new SystemMessage(`从对话中识别值得长期记住的用户信息，没有则返回空数组。
记住：preference（偏好）、fact（事实背景）、goal（目标）、event（重要事件）。`),
      new HumanMessage(`用户：${userMsg}\n助手：${assistantMsg.slice(0, 200)}`),
    ])
    return result.memories
  } catch { return [] }
}

// ── 构建个性化系统提示 ────────────────────────────────────────
function buildSystemPrompt(userData) {
  const { memories, name, sessionCount } = userData
  const parts = ['你是个性化前端开发助手。']

  if (name) parts.push(`用户名：${name}。`)
  if (sessionCount > 0) parts.push(`这是第 ${sessionCount + 1} 次对话。`)

  if (memories.length > 0) {
    // 按重要性取前 10 条
    const topMemories = [...memories]
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 10)

    const memByCategory = {}
    for (const m of topMemories) {
      if (!memByCategory[m.category]) memByCategory[m.category] = []
      memByCategory[m.category].push(m.content)
    }

    const categoryNames = { preference: '偏好', fact: '背景', goal: '目标', event: '经历' }
    const memLines = Object.entries(memByCategory)
      .map(([cat, items]) => `【${categoryNames[cat]}】${items.join('；')}`)
      .join('\n')

    parts.push(`\n用户背景：\n${memLines}`)
    parts.push('\n请根据用户背景提供个性化的回答，适当引用已知信息。')
  }

  return parts.join('\n')
}

// ── API 路由 ──────────────────────────────────────────────────

// 获取用户信息和记忆摘要
app.get('/api/users/:userId', async (req, res) => {
  const userData = await loadUserData(req.params.userId)
  res.json({
    userId: userData.userId,
    name: userData.name,
    sessionCount: userData.sessionCount,
    memoryCount: userData.memories.length,
    memories: userData.memories
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 20),
  })
})

// 更新用户名
app.patch('/api/users/:userId', async (req, res) => {
  const userData = await loadUserData(req.params.userId)
  if (req.body.name) userData.name = req.body.name
  await saveUserData(req.params.userId, userData)
  res.json({ success: true })
})

// 删除指定记忆
app.delete('/api/users/:userId/memories/:memoryIndex', async (req, res) => {
  const userData = await loadUserData(req.params.userId)
  const idx = parseInt(req.params.memoryIndex)
  userData.memories.splice(idx, 1)
  await saveUserData(req.params.userId, userData)
  res.json({ success: true })
})

// 流式对话（带记忆注入）
app.post('/api/chat/stream', async (req, res) => {
  const { userId, sessionId, message } = req.body
  if (!message?.trim()) return res.status(400).json({ error: '消息不能为空' })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const send = (event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  try {
    // 加载用户长期记忆
    const userData = await loadUserData(userId || 'default')
    const sessionHistory = getSessionHistory(sessionId || 'default')
    const history = await sessionHistory.getMessages()

    // 构建带记忆的系统提示
    const systemPrompt = buildSystemPrompt(userData)

    send('memory_loaded', {
      memoryCount: userData.memories.length,
      hasPersonalization: userData.memories.length > 0,
    })

    // 流式生成
    let fullReply = ''
    const stream = await model.stream([
      new SystemMessage(systemPrompt),
      ...history,
      new HumanMessage(message),
    ])

    for await (const chunk of stream) {
      if (chunk.content) {
        fullReply += chunk.content
        send('token', { token: chunk.content })
      }
    }

    // 保存会话历史
    await sessionHistory.addMessage(new HumanMessage(message))
    await sessionHistory.addMessage(new AIMessage(fullReply))

    // 异步提取并存储记忆（不阻塞响应）
    extractMemories(message, fullReply).then(async (newMemories) => {
      if (newMemories.length > 0) {
        const fresh = await loadUserData(userId || 'default')
        fresh.memories.push(...newMemories.map(m => ({
          ...m,
          extractedAt: new Date().toISOString(),
        })))
        // 去重（简单版）
        const seen = new Set()
        fresh.memories = fresh.memories.filter(m => {
          if (seen.has(m.content)) return false
          seen.add(m.content)
          return true
        })
        await saveUserData(userId || 'default', fresh)
        send('memories_extracted', { count: newMemories.length })
      }
    }).catch(() => {})

    // 更新会话计数
    if (history.length === 0) {
      userData.sessionCount++
      await saveUserData(userId || 'default', userData)
    }

    send('done', {})
  } catch (e) {
    send('error', { message: e.message })
  } finally {
    res.end()
  }
})

app.get('/health', (req, res) => res.json({ status: 'ok' }))

app.listen(3000, () => console.log('记忆服务已启动：http://localhost:3000'))
