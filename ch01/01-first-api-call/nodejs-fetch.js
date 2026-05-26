// nodejs-fetch.js
// Node.js 原生 fetch 调用 DeepSeek API（Node 18+ 内置 fetch，无需安装）
import 'dotenv/config'

const API_URL = 'https://api.deepseek.com/v1/chat/completions'
const API_KEY = process.env.DEEPSEEK_API_KEY

async function chat(userMessage) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: userMessage }],
      temperature: 0.7,
      max_tokens: 1024,
    }),
  })

  if (!res.ok) {
    const err = await res.json()
    throw new Error(`API 错误 ${res.status}: ${err.error?.message}`)
  }

  const data = await res.json()

  // 返回结构解析
  const reply = data.choices[0].message.content
  const usage = data.usage // { prompt_tokens, completion_tokens, total_tokens }

  console.log('回复：', reply)
  console.log('Token 用量：', usage)

  return { reply, usage }
}

// 运行示例
chat('用一句话解释什么是大模型').catch(console.error)
