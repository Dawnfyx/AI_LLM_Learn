// 01-langchain-basics/index.js
// LangChain.js 核心用法：模型调用、消息类型、批量调用、错误处理
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0.7,
})

// ── 1. 基础调用 ──────────────────────────────────────────────
async function basicInvoke() {
  console.log('\n=== 1. 基础调用 ===')

  const res = await model.invoke([
    new SystemMessage('你是一位 Vue3 技术专家，回答简洁精准。'),
    new HumanMessage('ref 和 reactive 的主要区别是什么？'),
  ])

  // res 是 AIMessage 对象
  console.log('内容：', res.content)
  console.log('类型：', res._getType()) // 'ai'
}

// ── 2. 多轮对话 ──────────────────────────────────────────────
async function multiTurnChat() {
  console.log('\n=== 2. 多轮对话 ===')

  const history = []

  async function chat(userInput) {
    history.push(new HumanMessage(userInput))

    const res = await model.invoke([
      new SystemMessage('你是前端开发导师。'),
      ...history,
    ])

    history.push(new AIMessage(res.content))
    return res.content
  }

  const r1 = await chat('Vue3 的 watch 和 watchEffect 有什么区别？')
  console.log('Q1回复（前100字）：', r1.slice(0, 100))

  const r2 = await chat('能给我举个 watchEffect 的实际使用场景吗？')
  console.log('Q2回复（前100字）：', r2.slice(0, 100))

  const r3 = await chat('我刚才问的第一个问题是什么？') // 测试上下文记忆
  console.log('Q3回复（验证记忆）：', r3.slice(0, 100))
}

// ── 3. 批量并发调用 ──────────────────────────────────────────
async function batchInvoke() {
  console.log('\n=== 3. 批量并发 ===')

  const questions = [
    'Vue3 中 defineProps 怎么用？',
    'React useCallback 的使用场景？',
    'Node.js 的事件循环是什么？',
  ]

  const start = Date.now()

  // 并发调用，比串行快很多
  const results = await Promise.all(
    questions.map(q => model.invoke([new HumanMessage(q)]))
  )

  console.log(`3 个问题并发耗时：${Date.now() - start}ms`)
  results.forEach((r, i) => {
    console.log(`Q${i + 1}: ${r.content.slice(0, 60)}...`)
  })
}

// ── 4. 流式调用 ──────────────────────────────────────────────
async function streamInvoke() {
  console.log('\n=== 4. 流式调用 ===')

  const stream = await model.stream([
    new HumanMessage('用 3 句话解释 Vue3 的响应式原理'),
  ])

  process.stdout.write('回复：')
  for await (const chunk of stream) {
    process.stdout.write(chunk.content)
  }
  console.log('\n')
}

// ── 5. 模型配置切换 ──────────────────────────────────────────
async function modelSwitch() {
  console.log('\n=== 5. 模型配置 ===')

  // 通过 .bind() 临时覆盖配置
  const preciseModel = model.bind({ temperature: 0 })
  const creativeModel = model.bind({ temperature: 1.2 })

  const prompt = [new HumanMessage('给一个 Vue3 项目起个名字')]

  const [r1, r2] = await Promise.all([
    preciseModel.invoke(prompt),
    creativeModel.invoke(prompt),
  ])

  console.log('低温度（精确）：', r1.content)
  console.log('高温度（创意）：', r2.content)
}

// 运行所有示例
await basicInvoke()
await multiTurnChat()
await batchInvoke()
await streamInvoke()
await modelSwitch()
