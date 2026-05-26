// 01-basic-function-call/index.js
// Function Call 基础：定义工具 → 绑定模型 → 执行工具 → 返回最终结果
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { tool } from '@langchain/core/tools'
import { HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages'
import { z } from 'zod'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0,
})

// ── 定义工具 ──────────────────────────────────────────────────
// tool() 第一个参数：工具执行函数
// tool() 第二个参数：描述（name/description/schema）—— 这个描述是给模型看的，决定它何时调用
const getWeatherTool = tool(
  async ({ city, unit = 'celsius' }) => {
    const mockData = {
      北京: { temp: 22, condition: '晴', humidity: 40 },
      上海: { temp: 26, condition: '多云', humidity: 65 },
      广州: { temp: 31, condition: '阵雨', humidity: 80 },
      深圳: { temp: 29, condition: '晴转多云', humidity: 70 },
    }

    const data = mockData[city]
    if (!data) return JSON.stringify({ error: `暂不支持 ${city}` })

    const temp = unit === 'fahrenheit' ? Math.round(data.temp * 9 / 5 + 32) : data.temp

    return JSON.stringify({
      city,
      temperature: `${temp}${unit === 'fahrenheit' ? '°F' : '°C'}`,
      condition: data.condition,
      humidity: `${data.humidity}%`,
      suggestion: data.condition.includes('雨') ? '记得带伞' : '天气不错，适合出行',
    })
  },
  {
    name: 'get_weather',
    description: '获取指定城市的实时天气信息。用户询问天气时调用此工具，不要自己编造天气数据。',
    schema: z.object({
      city: z.string().describe('城市名称，如：北京、上海、广州'),
      unit: z.enum(['celsius', 'fahrenheit']).default('celsius').describe('温度单位，默认摄氏度'),
    }),
  }
)

// ── 完整的 Function Call 流程 ─────────────────────────────────
async function chat(userMessage) {
  console.log('\n' + '─'.repeat(55))
  console.log('用户：', userMessage)

  // bindTools() 让模型知道有哪些工具可用
  const modelWithTools = model.bindTools([getWeatherTool])

  const messages = [
    new SystemMessage('你是天气助手，查询天气时必须使用 get_weather 工具获取真实数据。'),
    new HumanMessage(userMessage),
  ]

  // 第一次调用：模型决定是否调用工具
  const firstResponse = await modelWithTools.invoke(messages)

  console.log('finish_reason 类似字段 tool_calls 是否有内容：', !!firstResponse.tool_calls?.length)

  // 模型没有调用工具 → 直接回答
  if (!firstResponse.tool_calls?.length) {
    console.log('直接回答：', firstResponse.content)
    return firstResponse.content
  }

  // 模型调用了工具 → 执行工具，把结果返回给模型
  console.log('\n[工具调用]')
  const toolMessages = []

  for (const call of firstResponse.tool_calls) {
    console.log(`  调用 ${call.name}，参数：`, call.args)

    const result = await getWeatherTool.invoke(call.args)
    console.log(`  结果：`, result)

    // ToolMessage 的 tool_call_id 必须和 call.id 对应，模型靠这个关联结果
    toolMessages.push(
      new ToolMessage({ content: result, tool_call_id: call.id })
    )
  }

  // 第二次调用：把工具结果传回模型，生成自然语言回复
  const secondResponse = await modelWithTools.invoke([
    ...messages,
    firstResponse,    // 模型第一次的响应（含 tool_calls 字段）
    ...toolMessages,  // 工具执行的结果
  ])

  console.log('最终回复：', secondResponse.content)
  return secondResponse.content
}

await chat('北京今天天气怎么样？')
await chat('帮我查一下广州的天气，用华氏度')
await chat('你好，介绍一下你自己')  // 不触发工具
