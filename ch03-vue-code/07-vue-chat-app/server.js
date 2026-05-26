// 07-vue-chat-app/server.js
// 完整的 Vue3 + LangGraph 聊天应用后端
// 功能：多轮对话、流式输出、会话管理、对话历史持久化
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'
import { StateGraph, END, START, Annotation, messagesStateReducer } from '@langchain/langgraph'
import { InMemoryChatMessageHistory } from '@langchain/core/chat_history'
import { v4 as uuid } from 'uuid'

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

// 会话存储（生产环境换成 Redis）
const sessions = new Map()

function getOrCreateSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      id: sessionId,
      history: new InMemoryChatMessageHistory(),
      createdAt: new Date().toISOString(),
    })
  }
  return sessions.get(sessionId)
}

// ── LangGraph：带记忆的对话图 ────────────────────────────────
const ChatState = Annotation.Root({
  messages: Annotation({ reducer: messagesStateReducer, default: () => [] }),
  systemPrompt: Annotation({ reducer: (_, n) => n, default: () => '你是前端助手' }),
})

async function chatNode(state) {
  const res = await model.invoke([
    new SystemMessage(state.systemPrompt),
    ...state.messages,
  ])
  return { messages: [res] }
}

const chatGraph = new StateGraph(ChatState)
  .addNode('chat', chatNode)
  .addEdge(START, 'chat')
  .addEdge('chat', END)
  .compile()

// ── API 路由 ─────────────────────────────────────────────────

// 创建会话
app.post('/api/sessions', (req, res) => {
  const sessionId = uuid()
  getOrCreateSession(sessionId)
  res.json({ sessionId })
})

// 获取会话历史
app.get('/api/sessions/:id/history', async (req, res) => {
  const session = sessions.get(req.params.id)
  if (!session) return res.status(404).json({ error: '会话不存在' })

  const messages = await session.history.getMessages()
  res.json({
    sessionId: req.params.id,
    messages: messages.map(m => ({
      role: m._getType() === 'human' ? 'user' : 'assistant',
      content: m.content,
    })),
  })
})

// 删除会话
app.delete('/api/sessions/:id', (req, res) => {
  sessions.delete(req.params.id)
  res.json({ success: true })
})

// 普通聊天（非流式）
app.post('/api/chat', async (req, res) => {
  const { sessionId, message, systemPrompt = '你是前端开发助手，回答简洁专业。' } = req.body

  if (!message?.trim()) return res.status(400).json({ error: '消息不能为空' })

  const session = getOrCreateSession(sessionId || uuid())
  const history = await session.history.getMessages()

  try {
    const result = await chatGraph.invoke({
      messages: [...history, new HumanMessage(message)],
      systemPrompt,
    })

    const lastMsg = result.messages[result.messages.length - 1]
    const reply = lastMsg.content

    // 保存历史
    await session.history.addMessage(new HumanMessage(message))
    await session.history.addMessage(new AIMessage(reply))

    res.json({
      sessionId: session.id,
      reply,
      historyLength: (await session.history.getMessages()).length,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// 流式聊天（SSE）
app.post('/api/chat/stream', async (req, res) => {
  const { sessionId, message, systemPrompt = '你是前端开发助手，回答简洁专业。' } = req.body

  if (!message?.trim()) return res.status(400).json({ error: '消息不能为空' })

  const session = getOrCreateSession(sessionId || uuid())
  const history = await session.history.getMessages()

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  send('start', { sessionId: session.id })

  let fullReply = ''

  try {
    for await (const event of chatGraph.streamEvents(
      {
        messages: [...history, new HumanMessage(message)],
        systemPrompt,
      },
      { version: 'v2' }
    )) {
      if (
        event.event === 'on_chat_model_stream' &&
        typeof event.data?.chunk?.content === 'string' &&
        event.data.chunk.content
      ) {
        fullReply += event.data.chunk.content
        send('token', { token: event.data.chunk.content })
      }
    }

    // 保存到历史
    await session.history.addMessage(new HumanMessage(message))
    await session.history.addMessage(new AIMessage(fullReply))

    send('done', { sessionId: session.id })
  } catch (err) {
    send('error', { message: err.message })
  } finally {
    res.end()
  }
})

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', sessions: sessions.size })
})

app.listen(3000, () => {
  console.log('聊天服务已启动：http://localhost:3000')
})
