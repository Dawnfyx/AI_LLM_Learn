// server.js
import 'dotenv/config'
import express from 'express'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage } from '@langchain/core/messages'

const app = express()
app.use(express.json())
app.use(express.static('.'))

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: {
    baseURL: process.env.DEEPSEEK_API_URL
  },
  temperature: 0.7,
  timeout: 60000,
  maxRetries: 3,
  streaming: true,
})


app.post('/api/chat/stream', async (req, res) => {
  const { message } = req.body

  // SSE 必须设置这三个响应头
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  try {
    // stream() 返回 AsyncIterable，逐 chunk 推送
    const stream = await model.stream([new HumanMessage(message)])

    for await (const chunk of stream) {
      if (chunk.content) {
        // SSE 格式：event 行 + data 行 + 空行
        res.write(`event: token\ndata: ${JSON.stringify({ token: chunk.content })}\n\n`)
      }
    }

    res.write('event: done\ndata: {}\n\n')
  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`)
  } finally {
    res.end()
  }
})

app.listen(3000, () => console.log('http://localhost:3000'))