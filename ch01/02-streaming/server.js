// server.js
// Express 服务端：调用 DeepSeek 流式接口，通过 SSE 推送给前端
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage } from '@langchain/core/messages'

const app = express()
app.use(cors())
app.use(express.json())
app.use(express.static('.')) // 同目录下的 index.html

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  streaming: true,
})

// SSE 流式接口
app.post('/api/chat/stream', async (req, res) => {
  const { message } = req.body

  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  try {
    // LangChain stream() 方法，逐 chunk 输出
    const stream = await model.stream([new HumanMessage(message)])

    for await (const chunk of stream) {
      const token = chunk.content
      if (token) {
        // SSE 格式：event: token\ndata: {...}\n\n
        res.write(`event: token\ndata: ${JSON.stringify({ token })}\n\n`)
      }
    }

    res.write('event: done\ndata: {}\n\n')
  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`)
  } finally {
    res.end()
  }
})

app.listen(3000, () => console.log('服务已启动：http://localhost:3000'))
