// langchain-basic.js
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'

const model = new ChatOpenAI({
  model: 'deepseek-v4-flash',
  apiKey: process.env.DEEPSEEK_API_KEY,
  temperature: 0.7,
  timeout: 60000,
  maxRetries: 3,
  configuration: {
    baseURL: process.env.DEEPSEEK_API_URL
  }
})

const res = await model.invoke([
  new SystemMessage('你是一位耐心的前端开发导师，擅长用类比解释技术概念。'),
  new HumanMessage('用"盖房子"来类比解释什么是大模型应用开发'),
])

console.log(res.content)