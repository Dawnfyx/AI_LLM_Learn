// nodejs-fetch.js
import 'dotenv/config'

async function chat(userMessage) {
  const res = await fetch(process.env.DEEPSEEK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
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
  const reply = data.choices[0].message.content
  const usage = data.usage // { prompt_tokens, completion_tokens, total_tokens }

  console.log('回复：', reply)
  console.log('Token 用量：', usage)

  return { reply, usage }
}

chat('用一句话解释什么是大模型').catch(console.error)