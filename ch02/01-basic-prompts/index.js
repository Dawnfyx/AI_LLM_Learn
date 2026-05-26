// 含糊提示 vs 精确提示的效果对比
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0.3,
})

async function compare() {
  console.log('=== 含糊提示 ===')
  const vague = await model.invoke([new HumanMessage('帮我写代码')])
  console.log(vague.content)

  console.log('\n=== 精确提示 ===')
  const precise = await model.invoke([
    new SystemMessage(`你是一位资深前端工程师，代码风格简洁，注重可读性。
输出格式：先给出代码，再用 3 条要点解释关键设计决策。`),
    new HumanMessage(`用 Vue3 Composition API 写一个 useLocalStorage Hook：
1. 支持任意类型的值（JSON 序列化）
2. 数据变化时自动同步到 localStorage
3. 处理 JSON 解析异常，异常时返回默认值`),
  ])
  console.log(precise.content)
}

compare().catch(console.error)
