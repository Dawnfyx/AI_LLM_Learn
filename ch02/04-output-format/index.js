// 结构化输出：两种方式让模型稳定返回 JSON
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

// 方式一：Prompt 约束（简单但稳定性一般）
async function reviewWithPrompt(code) {
  const res = await model.invoke([
    new SystemMessage(`审查代码，只输出 JSON，格式：
{"hasIssues":boolean,"issues":[{"type":string,"description":string,"severity":"error"|"warning"|"info"}],"score":number}`),
    new HumanMessage(`审查：\n${code}`),
  ])
  const text = res.content.replace(/```json\n?|\n?```/g, '').trim()
  return JSON.parse(text)
}

// 方式二：withStructuredOutput（LangChain 内置，推荐用这个）
const ReviewSchema = z.object({
  hasIssues: z.boolean(),
  issues: z.array(z.object({
    type: z.string(),
    description: z.string(),
    severity: z.enum(['error', 'warning', 'info']),
  })),
  suggestions: z.array(z.string()),
  score: z.number().min(0).max(100).describe('代码质量评分 0-100'),
})

const structuredModel = model.withStructuredOutput(ReviewSchema)

async function reviewWithSchema(code) {
  return structuredModel.invoke([
    new SystemMessage('你是 Vue3 代码审查专家，分析代码质量和潜在问题。'),
    new HumanMessage(`审查：\n${code}`),
  ])
}

// 测试：一段有明显问题的 Vue3 代码
const badCode = `
<script setup>
import { ref, onMounted } from 'vue'
const data = ref([])
let timer = null

onMounted(() => {
  timer = setInterval(() => {
    fetch('/api/data').then(r => r.json()).then(d => { data.value = d })
  }, 1000)
  // 缺少 onUnmounted 清除 timer，会内存泄漏
})
</script>
`

console.log('方式一（Prompt 约束）:')
console.log(JSON.stringify(await reviewWithPrompt(badCode), null, 2))

console.log('\n方式二（Schema 约束）:')
console.log(JSON.stringify(await reviewWithSchema(badCode), null, 2))
