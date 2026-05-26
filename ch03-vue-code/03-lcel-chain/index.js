// 03-lcel-chain/index.js
// LCEL（LangChain Expression Language）：用管道符 | 组合链
// 核心思路：prompt | model | outputParser，每一步都是可组合的 Runnable
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { ChatPromptTemplate } from '@langchain/core/prompts'
import { StringOutputParser, JsonOutputParser } from '@langchain/core/output_parsers'
import { RunnableSequence, RunnableParallel } from '@langchain/core/runnables'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0.3,
})

// ── 1. 最简单的链：prompt | model | parser ───────────────────
async function simpleChain() {
  console.log('\n=== 1. 最简链 ===')

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', '你是前端技术专家，回答简洁，不超过 3 句话。'],
    ['human', '{question}'],
  ])

  // pipe 方式：prompt → model → 字符串解析器
  const chain = prompt.pipe(model).pipe(new StringOutputParser())

  // invoke：单次调用
  const result = await chain.invoke({ question: '什么是 Vue3 的 Teleport 组件？' })
  console.log('结果类型：', typeof result) // string，不是 AIMessage
  console.log('内容：', result)
}

// ── 2. JSON 输出链 ───────────────────────────────────────────
async function jsonChain() {
  console.log('\n=== 2. JSON 输出链 ===')

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', `分析前端技术，只输出 JSON，格式：
{
  "name": string,
  "category": "框架"|"工具"|"语言"|"库",
  "difficulty": 1-5,
  "useCases": string[],
  "relatedTech": string[]
}`],
    ['human', '分析：{tech}'],
  ])

  const chain = prompt.pipe(model).pipe(new StringOutputParser())

  const result = await chain.invoke({ tech: 'Vite' })
  try {
    const json = JSON.parse(result.replace(/```json\n?|\n?```/g, '').trim())
    console.log('解析后：', JSON.stringify(json, null, 2))
  } catch {
    console.log('原始结果：', result)
  }
}

// ── 3. 链式组合：多步处理 ────────────────────────────────────
async function sequentialChain() {
  console.log('\n=== 3. 顺序链（多步）===')

  const parser = new StringOutputParser()

  // 第一步：分析需求，提取关键信息
  const analyzePrompt = ChatPromptTemplate.fromMessages([
    ['system', '你是需求分析师，提取需求的核心功能点，每点一行，不超过 5 个。'],
    ['human', '需求：{requirement}'],
  ])

  // 第二步：根据功能点生成组件列表
  const componentPrompt = ChatPromptTemplate.fromMessages([
    ['system', '你是 Vue3 架构师，根据功能点列出需要的组件，每个组件一行，格式：组件名：作用。'],
    ['human', '功能点：\n{features}'],
  ])

  // 第三步：生成项目结构
  const structurePrompt = ChatPromptTemplate.fromMessages([
    ['system', '你是前端工程师，根据组件列表生成 src/ 目录结构，用树状图展示。'],
    ['human', '组件列表：\n{components}'],
  ])

  // 用 RunnableSequence 组合，前一步的输出自动传入下一步
  const chain = RunnableSequence.from([
    // 第一步输入 requirement → 输出 features
    {
      features: analyzePrompt.pipe(model).pipe(parser),
      requirement: (input) => input.requirement,
    },
    // 第二步输入 features → 输出 components
    {
      components: componentPrompt.pipe(model).pipe(parser),
      features: (input) => input.features,
    },
    // 第三步输入 components → 输出最终结果
    structurePrompt.pipe(model).pipe(parser),
  ])

  const result = await chain.invoke({
    requirement: '电商后台管理系统：商品管理、订单管理、用户管理、数据统计看板',
  })

  console.log('生成的项目结构：\n', result)
}

// ── 4. 并行链：同时执行多个任务 ─────────────────────────────
async function parallelChain() {
  console.log('\n=== 4. 并行链 ===')

  const parser = new StringOutputParser()

  const makeChain = (systemPrompt) =>
    ChatPromptTemplate.fromMessages([
      ['system', systemPrompt],
      ['human', '{topic}'],
    ]).pipe(model).pipe(parser)

  // 同时从多个角度分析同一个主题
  const parallelChains = RunnableParallel.from({
    pros: makeChain('列出这个技术方案的 3 个优点，每点一行'),
    cons: makeChain('列出这个技术方案的 3 个缺点，每点一行'),
    alternatives: makeChain('列出 2-3 个替代方案，每个简短说明适用场景'),
  })

  const result = await parallelChains.invoke({
    topic: '使用 Pinia 做 Vue3 项目的全局状态管理',
  })

  console.log('优点：\n', result.pros)
  console.log('\n缺点：\n', result.cons)
  console.log('\n替代方案：\n', result.alternatives)
}

// ── 5. 流式链 ────────────────────────────────────────────────
async function streamChain() {
  console.log('\n=== 5. 流式链 ===')

  const chain = ChatPromptTemplate.fromMessages([
    ['system', '你是技术写作专家，写作风格清晰易懂。'],
    ['human', '写一篇关于 {topic} 的简短技术博客（200字以内）'],
  ]).pipe(model).pipe(new StringOutputParser())

  // stream() 方法在链上同样可用
  const stream = await chain.stream({ topic: 'Vue3 Composition API 的核心优势' })

  process.stdout.write('博客内容：')
  for await (const chunk of stream) {
    process.stdout.write(chunk)
  }
  console.log('\n')
}

// ── 6. 带重试和超时的链 ──────────────────────────────────────
async function robustChain() {
  console.log('\n=== 6. 健壮性配置 ===')

  // withRetry：失败自动重试
  const reliableModel = model.withRetry({
    stopAfterAttempt: 3,      // 最多重试 3 次
    onFailedAttempt: (err) => console.log(`重试中... 错误：${err.message}`),
  })

  // withFallbacks：主模型失败时用备用模型
  // const modelWithFallback = model.withFallbacks([backupModel])

  const chain = ChatPromptTemplate.fromMessages([
    ['human', '{question}'],
  ]).pipe(reliableModel).pipe(new StringOutputParser())

  try {
    const result = await chain.invoke({ question: 'Vite 比 Webpack 快在哪里？' })
    console.log('结果：', result.slice(0, 150))
  } catch (err) {
    console.error('所有重试均失败：', err.message)
  }
}

await simpleChain()
await jsonChain()
await sequentialChain()
await parallelChain()
await streamChain()
await robustChain()
