// 05-vue-memory-app/server.js
// 完整记忆系统服务端：用户画像 + 长期记忆 + 会话管理
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import fs from 'fs/promises'
import path from 'path'
import { ChatOpenAI } from '@langchain/openai'
import { OpenAIEmbeddings } from '@langchain/openai'
import { MemoryVectorStore } from 'langchain/vectorstores/memory'
import { Document } from '@langchain/core/documents'
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'
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

const embeddings = new OpenAIEmbeddings({
  model: 'text-embedding-3-small',
  apiKey: process.env.OPENAI_API_KEY,
})

// ── 全局存储（生产换 Redis + PostgreSQL）────────────────────
const DATA_DIR = './data'
const userVectorStores = new Map()   // userId → MemoryVectorStore
const sessionHistories = new Map()   // sessionId → messages[]

// ── 工具函数 ──────────────────────────────────────────────────
async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true })
}

async function loadProfile(userId) {
  try {
    const data = await fs.readFile(path.join(DATA_DIR, 'profiles', `${userId}.json`), 'utf-8')
    return JSON.parse(data)
  } catch {
    return { techStack: [], knownTopics: [], preferences: {} }
  }
}

async function saveProfile(userId, profile) {
  await ensureDir(path.join(DATA_DIR, 'profiles'))
  await fs.writeFile(
    path.join(DATA_DIR, 'profiles', `${userId}.json`),
    JSON.stringify(profile, null, 2)
  )
}

function getVectorStore(userId) {
  if (!userVectorStores.has(userId)) {
    userVectorStores.set(userId, new MemoryVectorStore(embeddings))
  }
  return userVectorStores.get(userId)
}

function estTokens(text) {
  const cn = (text.match(/[\u4e00-\u9fff]/g) || []).length
  return Math.ceil(cn * 0.6 + (text.length - cn) * 0.25)
}

function trimHistory(history, maxTokens = 2000) {
  let total = 0
  const result = []
  for (let i = history.length - 1; i >= 0; i--) {
    const t = estTokens(history[i].content || '')
    if (total + t > maxTokens) break
    result.unshift(history[i])
    total += t
  }
  return result
}

function profileToContext(profile) {
  const parts = []
  if (profile.name) parts.push(`用户：${profile.name}`)
  if (profile.techLevel) parts.push(`水平：${profile.techLevel}`)
  if (profile.techStack?.length) parts.push(`技术栈：${profile.techStack.join(', ')}`)
  if (profile.currentGoal) parts.push(`目标：${profile.currentGoal}`)
  if (profile.knownTopics?.length) parts.push(`已掌握：${profile.knownTopics.slice(0, 5).join(', ')}`)
  return parts.length ? `用户背景：${parts.join('；')}` : ''
}

// ── API：发送消息（流式）──────────────────────────────────────
app.post('/api/chat/stream', async (req, res) => {
  const { userId = 'anonymous', sessionId, message } = req.body
  if (!message?.trim()) return res.status(400).json({ error: '消息不能为空' })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const send = (event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  try {
    // 1. 加载用户画像
    const profile = await loadProfile(userId)
    const profileCtx = profileToContext(profile)

    // 2. 检索相关长期记忆
    const vs = getVectorStore(userId)
    let memCtx = ''
    try {
      const docs = await vs.similaritySearchWithScore(message, 3)
      const relevant = docs.filter(([, s]) => s > 0.3)
      if (relevant.length) {
        memCtx = '\n相关记忆：\n' + relevant.map(([d]) => `- ${d.pageContent}`).join('\n')
        send('memories', { count: relevant.length, items: relevant.map(([d]) => d.pageContent.slice(0, 60)) })
      }
    } catch {}

    // 3. 获取会话历史
    const sid = sessionId || `session_${userId}`
    if (!sessionHistories.has(sid)) sessionHistories.set(sid, [])
    const history = sessionHistories.get(sid)
    const trimmed = trimHistory(history)

    // 4. 构建 system
    const systemParts = ['你是前端开发助手，根据用户背景个性化回答。']
    if (profileCtx) systemParts.push(profileCtx)
    if (memCtx) systemParts.push(memCtx)

    history.push(new HumanMessage(message))

    // 5. 流式生成
    send('start', {})
    let fullReply = ''

    for await (const event of (await model.bindTools([]).stream([
      new SystemMessage(systemParts.join('\n\n')),
      ...trimmed.slice(-8),
      new HumanMessage(message),
    ]))) {
      if (event.content) {
        fullReply += event.content
        send('token', { token: event.content })
      }
    }

    history.push(new AIMessage(fullReply))

    // 6. 后台：异步更新长期记忆
    updateMemory(userId, message, fullReply, profile).catch(() => {})

    send('done', {})
  } catch (e) {
    send('error', { message: e.message })
  } finally {
    res.end()
  }
})

// 后台记忆更新
async function updateMemory(userId, userMsg, aiMsg, currentProfile) {
  const MemSchema = z.object({
    hasInfo: z.boolean(),
    memories: z.array(z.object({
      content: z.string(),
      type: z.enum(['fact', 'preference', 'goal', 'skill']),
    })).optional(),
    profileUpdates: z.object({
      name: z.string().optional(),
      techLevel: z.string().optional(),
      techStack: z.array(z.string()).optional(),
      currentGoal: z.string().optional(),
    }).optional(),
  })

  const extractModel = model.withStructuredOutput(MemSchema)
  const result = await extractModel.invoke([
    new SystemMessage('从对话中提取值得长期记忆的信息。'),
    new HumanMessage(`用户：${userMsg}\nAI：${aiMsg.slice(0, 200)}`),
  ])

  if (!result.hasInfo) return

  // 更新向量记忆库
  if (result.memories?.length) {
    const vs = getVectorStore(userId)
    const docs = result.memories.map(m => new Document({
      pageContent: m.content,
      metadata: { userId, type: m.type, createdAt: new Date().toISOString() },
    }))
    await vs.addDocuments(docs)
  }

  // 更新用户画像
  if (result.profileUpdates) {
    const u = result.profileUpdates
    const updated = { ...currentProfile }
    if (u.name) updated.name = u.name
    if (u.techLevel) updated.techLevel = u.techLevel
    if (u.currentGoal) updated.currentGoal = u.currentGoal
    if (u.techStack?.length) {
      updated.techStack = [...new Set([...(currentProfile.techStack || []), ...u.techStack])]
    }
    await saveProfile(userId, updated)
  }
}

// ── API：获取用户画像 ─────────────────────────────────────────
app.get('/api/profile/:userId', async (req, res) => {
  const profile = await loadProfile(req.params.userId)
  res.json(profile)
})

// ── API：获取长期记忆列表 ──────────────────────────────────────
app.get('/api/memories/:userId', async (req, res) => {
  const vs = getVectorStore(req.params.userId)
  // MemoryVectorStore 暂不支持直接列出所有文档
  // 生产中用 Chroma/Pinecone，通过 userId filter 查询
  res.json({ memories: [], note: '生产环境接 Chroma，支持按 userId 过滤查询' })
})

// ── API：清除记忆 ─────────────────────────────────────────────
app.delete('/api/memories/:userId', async (req, res) => {
  userVectorStores.delete(req.params.userId)
  try {
    await fs.unlink(path.join(DATA_DIR, 'profiles', `${req.params.userId}.json`))
  } catch {}
  res.json({ success: true })
})

app.get('/health', (req, res) => res.json({ status: 'ok', sessions: sessionHistories.size }))

app.listen(3000, () => console.log('记忆系统服务已启动：http://localhost:3000'))
