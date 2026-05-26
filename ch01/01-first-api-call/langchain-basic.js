// langchain-basic.js
// LangChain.js 封装调用，屏蔽底层 HTTP 细节
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'

// 初始化模型（兼容 OpenAI API 格式的任意模型）
const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0.7,
})

async function main() {
  // 单次对话
  const res = await model.invoke([
    new SystemMessage('你是一位耐心的前端开发导师，擅长用类比解释技术概念。'),
    new HumanMessage('用"盖房子"来类比解释什么是大模型应用开发'),
  ])

  console.log(res.content)

  // 批量调用（并发）
  const questions = [
    '什么是 Token？',
    '什么是上下文窗口？',
    '温度参数有什么用？',
  ]

  const results = await Promise.all(
    questions.map(q => model.invoke([new HumanMessage(q)]))
  )

  results.forEach((r, i) => {
    console.log(`\nQ: ${questions[i]}`)
    console.log(`A: ${r.content.slice(0, 100)}...`)
  })
}

main().catch(console.error)
