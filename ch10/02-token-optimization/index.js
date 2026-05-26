// 02-token-optimization/index.js
// Token 优化：压缩 Prompt、裁剪上下文、结构化输出减少冗余
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { z } from 'zod'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0,
})

// ── Token 估算 ────────────────────────────────────────────────
function estTokens(text) {
  const cn = (text.match(/[\u4e00-\u9fff]/g) || []).length
  return Math.ceil(cn * 0.6 + (text.length - cn) * 0.25)
}

// ── 1. System Prompt 压缩 ─────────────────────────────────────
// 冗长的 system prompt 每次都要消耗 token，精简一半效果差不多
const verboseSystem = `
你是一个非常专业、经验丰富的高级前端开发工程师和技术专家，拥有超过10年的前端开发经验。
你精通各种前端技术栈，包括但不限于 Vue2、Vue3、React、Angular、TypeScript、JavaScript 等。
你非常善于解释技术概念，能够根据用户的技术水平提供适合的解答。
你的回答应该简洁、准确、有帮助，必要时提供代码示例。
你总是以友好、专业的方式与用户交流，让用户感到舒适和被尊重。
在回答问题时，你会先理解问题的核心需求，然后提供最优解。
`

const compactSystem = `前端专家，精通 Vue3/React/TS。回答简洁准确，必要时给代码示例。`

console.log(`冗长版 system: ${estTokens(verboseSystem)} tokens`)
console.log(`精简版 system: ${estTokens(compactSystem)} tokens`)
console.log(`节省: ${estTokens(verboseSystem) - estTokens(compactSystem)} tokens/次`)
console.log(`100 次调用节省: ≈¥${((estTokens(verboseSystem) - estTokens(compactSystem)) * 100 / 1e6 * 0.27 * 7.2).toFixed(3)}`)

// ── 2. 动态 Prompt 构建（按需加载） ──────────────────────────
// 不把所有指令都放进 system，只加入当前任务需要的部分
class DynamicPromptBuilder {
  constructor(baseSystem) {
    this.baseSystem = baseSystem   // 基础 system（每次都有）
    this.modules = {}              // 可选模块
  }

  addModule(name, content) {
    this.modules[name] = content
    return this
  }

  build(activeModules = []) {
    const parts = [this.baseSystem]
    for (const name of activeModules) {
      if (this.modules[name]) parts.push(this.modules[name])
    }
    return parts.join('\n')
  }
}

const builder = new DynamicPromptBuilder('你是前端助手。')
  .addModule('code', '代码要有注释，用现代 ES 语法。')
  .addModule('security', '注意 XSS 防范和输入校验。')
  .addModule('perf', '关注性能，避免不必要渲染。')
  .addModule('a11y', '确保无障碍访问，添加 aria 属性。')

// 普通问答：只用基础 system
const basicSystem = builder.build([])
// 代码审查：加载代码和安全模块
const codeReviewSystem = builder.build(['code', 'security'])
// 性能分析：加载性能模块
const perfSystem = builder.build(['perf'])

console.log(`\n基础 system: ${estTokens(basicSystem)} tokens`)
console.log(`代码审查 system: ${estTokens(codeReviewSystem)} tokens`)
console.log(`全部模块: ${estTokens(builder.build(Object.keys(builder.modules)))} tokens`)

// ── 3. 上下文裁剪 ─────────────────────────────────────────────
// 对话历史过长时，按重要性裁剪而不是简单截断
class SmartContextTrimmer {
  constructor({ maxTokens = 3000, keepFirst = 2 } = {}) {
    this.maxTokens = maxTokens
    this.keepFirst = keepFirst   // 始终保留前 N 条（通常是重要的背景信息）
  }

  trim(messages) {
    const totalTokens = messages.reduce((s, m) => s + estTokens(m.content || ''), 0)
    if (totalTokens <= this.maxTokens) return messages

    // 始终保留最前面的几条（重要背景）和最近的几条
    const alwaysKeep = new Set([
      ...messages.slice(0, this.keepFirst).map((_, i) => i),
      ...messages.slice(-4).map((_, i) => messages.length - 4 + i),
    ])

    // 中间的消息按 token 从大到小排序，优先丢弃大消息
    const middle = messages
      .map((m, i) => ({ i, m, t: estTokens(m.content || '') }))
      .filter(({ i }) => !alwaysKeep.has(i))
      .sort((a, b) => b.t - a.t)

    const toRemove = new Set()
    let currentTokens = totalTokens

    for (const { i, t } of middle) {
      if (currentTokens <= this.maxTokens) break
      toRemove.add(i)
      currentTokens -= t
    }

    const trimmed = messages.filter((_, i) => !toRemove.has(i))
    console.log(`  [裁剪] ${messages.length} 条 → ${trimmed.length} 条, ${totalTokens} → ${currentTokens} tokens`)
    return trimmed
  }
}

// ── 4. 结构化输出减少 token ───────────────────────────────────
// 让模型返回 JSON 而不是自然语言，减少描述性文字的 token 消耗
async function structuredVsNatural(code) {
  console.log('\n--- 结构化 vs 自然语言输出 ---')

  // 自然语言版本（token 多）
  const naturalStart = Date.now()
  const naturalRes = await model.invoke([
    new SystemMessage('你是代码审查专家，对代码进行详细分析。'),
    new HumanMessage(`请详细分析这段代码的问题，包括：问题类型、具体描述、严重程度、修复建议：\n${code}`),
  ])
  const naturalTokens = estTokens(naturalRes.content)
  console.log(`自然语言输出: ${naturalTokens} tokens, ${Date.now() - naturalStart}ms`)

  // 结构化版本（token 少）
  const ReviewSchema = z.object({
    issues: z.array(z.object({
      type: z.string(),
      desc: z.string(),
      severity: z.enum(['error', 'warning', 'info']),
      fix: z.string(),
    })),
    score: z.number().min(0).max(100),
  })

  const structuredStart = Date.now()
  const structuredRes = await model.withStructuredOutput(ReviewSchema).invoke([
    new SystemMessage('代码审查专家，输出 JSON。'),
    new HumanMessage(`审查：\n${code}`),
  ])
  const structuredTokens = estTokens(JSON.stringify(structuredRes))
  console.log(`结构化输出: ${structuredTokens} tokens, ${Date.now() - structuredStart}ms`)
  console.log(`减少: ${naturalTokens - structuredTokens} tokens (${((1 - structuredTokens / naturalTokens) * 100).toFixed(0)}%)`)
}

// ── 5. 批量处理减少请求次数 ──────────────────────────────────
async function batchProcessing(items) {
  console.log('\n--- 批量处理 vs 逐个处理 ---')

  // 逐个处理（N 次请求）
  console.log('逐个处理...')
  const singleStart = Date.now()
  const singleResults = await Promise.all(
    items.map(item => model.invoke([
      new SystemMessage('提取技术关键词，JSON 数组，3个词。只输出 JSON。'),
      new HumanMessage(item),
    ]))
  )
  console.log(`逐个处理: ${items.length} 次请求, ${Date.now() - singleStart}ms`)

  // 批量处理（1 次请求）
  console.log('批量处理...')
  const batchStart = Date.now()
  const batchRes = await model.invoke([
    new SystemMessage(`对每条文本提取 3 个技术关键词。
输出 JSON 数组，每个元素对应一条输入：[["词1","词2","词3"], ...]
只输出 JSON，不加解释。`),
    new HumanMessage(`文本列表：\n${items.map((item, i) => `${i + 1}. ${item}`).join('\n')}`),
  ])
  const batchTokens = estTokens(batchRes.content)
  console.log(`批量处理: 1 次请求, ${Date.now() - batchStart}ms, ${batchTokens} tokens`)
}

// 测试
const testCode = `
async function fetchUserData(userId) {
  const res = await fetch('/api/user/' + userId)
  const data = res.json()
  return data
}
`

await structuredVsNatural(testCode)

await batchProcessing([
  'Vue3 组件通信方式',
  'React Hooks 最佳实践',
  'TypeScript 类型系统',
])
