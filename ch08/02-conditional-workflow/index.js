// 02-conditional-workflow/index.js
// 条件工作流：根据中间结果动态决定后续步骤
// 场景：代码 Review 流程 - 分类 → 不同策略处理 → 生成报告
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { ChatPromptTemplate } from '@langchain/core/prompts'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { StateGraph, END, START, Annotation } from '@langchain/langgraph'
import { z } from 'zod'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0,
})

const parser = new StringOutputParser()

// ── 状态定义 ──────────────────────────────────────────────────
const State = Annotation.Root({
  code:          Annotation({ reducer: (_, n) => n, default: () => '' }),
  language:      Annotation({ reducer: (_, n) => n, default: () => 'javascript' }),
  // 分类结果
  codeType:      Annotation({ reducer: (_, n) => n, default: () => '' }),  // component | utility | api | config
  complexity:    Annotation({ reducer: (_, n) => n, default: () => '' }),  // low | medium | high
  // 各审查维度的结果
  securityIssues:    Annotation({ reducer: (_, n) => n, default: () => '' }),
  performanceIssues: Annotation({ reducer: (_, n) => n, default: () => '' }),
  styleIssues:       Annotation({ reducer: (_, n) => n, default: () => '' }),
  logicIssues:       Annotation({ reducer: (_, n) => n, default: () => '' }),
  // 最终报告
  report:        Annotation({ reducer: (_, n) => n, default: () => '' }),
  score:         Annotation({ reducer: (_, n) => n, default: () => 0 }),
})

// ── 节点：代码分类 ────────────────────────────────────────────
const ClassifySchema = z.object({
  codeType: z.enum(['component', 'utility', 'api', 'config', 'test']),
  complexity: z.enum(['low', 'medium', 'high']),
  primaryConcerns: z.array(z.string()).describe('主要需要关注的维度'),
})

async function classifyNode(state) {
  console.log('\n[分类] 判断代码类型...')

  const classifyModel = model.withStructuredOutput(ClassifySchema)
  const result = await classifyModel.invoke([
    { role: 'system', content: '分析代码类型和复杂度。' },
    { role: 'user', content: `分析这段 ${state.language} 代码：\n${state.code}` },
  ])

  console.log(`  类型: ${result.codeType}, 复杂度: ${result.complexity}`)
  console.log(`  关注点: ${result.primaryConcerns.join(', ')}`)

  return {
    codeType: result.codeType,
    complexity: result.complexity,
  }
}

// ── 条件路由：根据代码类型选择审查策略 ─────────────────────
function routeByType(state) {
  // 组件代码：重点看性能和风格
  if (state.codeType === 'component') return 'review_component'
  // API/工具函数：重点看安全和逻辑
  if (state.codeType === 'utility' || state.codeType === 'api') return 'review_logic'
  // 其他：通用审查
  return 'review_general'
}

// ── 节点：组件专项审查 ────────────────────────────────────────
async function reviewComponentNode(state) {
  console.log('\n[审查] 组件性能和风格审查...')

  const [perfResult, styleResult] = await Promise.all([
    // 性能审查
    ChatPromptTemplate.fromMessages([
      ['system', '你是 Vue3/React 性能专家，检查组件的性能问题。'],
      ['human', '检查性能问题（重复渲染、内存泄漏、不必要计算）：\n{code}'],
    ]).pipe(model).pipe(parser).invoke({ code: state.code }),

    // 风格审查
    ChatPromptTemplate.fromMessages([
      ['system', '你是前端代码规范专家，检查代码风格。'],
      ['human', '检查代码风格问题（命名、结构、可读性）：\n{code}'],
    ]).pipe(model).pipe(parser).invoke({ code: state.code }),
  ])

  return {
    performanceIssues: perfResult,
    styleIssues: styleResult,
  }
}

// ── 节点：逻辑安全审查 ────────────────────────────────────────
async function reviewLogicNode(state) {
  console.log('\n[审查] 逻辑和安全审查...')

  const [logicResult, secResult] = await Promise.all([
    ChatPromptTemplate.fromMessages([
      ['system', '你是代码逻辑专家，检查逻辑错误。'],
      ['human', '检查逻辑问题（边界条件、错误处理、空值判断）：\n{code}'],
    ]).pipe(model).pipe(parser).invoke({ code: state.code }),

    ChatPromptTemplate.fromMessages([
      ['system', '你是安全专家，检查安全漏洞。'],
      ['human', '检查安全问题（XSS、注入、敏感数据泄露）：\n{code}'],
    ]).pipe(model).pipe(parser).invoke({ code: state.code }),
  ])

  return {
    logicIssues: logicResult,
    securityIssues: secResult,
  }
}

// ── 节点：通用审查 ────────────────────────────────────────────
async function reviewGeneralNode(state) {
  console.log('\n[审查] 通用审查...')

  const result = await ChatPromptTemplate.fromMessages([
    ['system', '你是代码审查专家，进行全面代码审查。'],
    ['human', '全面审查（逻辑、风格、性能、安全）：\n{code}'],
  ]).pipe(model).pipe(parser).invoke({ code: state.code })

  return { logicIssues: result }
}

// ── 节点：生成综合报告 ────────────────────────────────────────
// 无论走哪条审查路径，最终都汇聚到这个节点
async function generateReportNode(state) {
  console.log('\n[报告] 生成综合报告...')

  const issues = [
    state.securityIssues && `**安全问题：**\n${state.securityIssues}`,
    state.performanceIssues && `**性能问题：**\n${state.performanceIssues}`,
    state.styleIssues && `**风格问题：**\n${state.styleIssues}`,
    state.logicIssues && `**逻辑问题：**\n${state.logicIssues}`,
  ].filter(Boolean).join('\n\n')

  const ScoreSchema = z.object({
    score: z.number().min(0).max(100),
    summary: z.string(),
    topPriority: z.string(),
  })

  const scoreModel = model.withStructuredOutput(ScoreSchema)
  const scoring = await scoreModel.invoke([
    { role: 'system', content: '根据代码审查结果给出评分（0-100）。' },
    { role: 'user', content: `代码审查结果：\n${issues}\n\n给出评分、摘要和最高优先级问题。` },
  ])

  const report = `# 代码审查报告

**代码类型：** ${state.codeType}  **复杂度：** ${state.complexity}  **评分：** ${scoring.score}/100

**总结：** ${scoring.summary}

**最高优先级：** ${scoring.topPriority}

---

${issues}`

  return { report, score: scoring.score }
}

// ── 构建条件工作流 ────────────────────────────────────────────
const reviewWorkflow = new StateGraph(State)
  .addNode('classify',         classifyNode)
  .addNode('review_component', reviewComponentNode)
  .addNode('review_logic',     reviewLogicNode)
  .addNode('review_general',   reviewGeneralNode)
  .addNode('generate_report',  generateReportNode)
  .addEdge(START, 'classify')
  // 条件分叉：根据代码类型选择审查路径
  .addConditionalEdges('classify', routeByType, {
    review_component: 'review_component',
    review_logic:     'review_logic',
    review_general:   'review_general',
  })
  // 三条路径最终都汇聚到 generate_report
  .addEdge('review_component', 'generate_report')
  .addEdge('review_logic',     'generate_report')
  .addEdge('review_general',   'generate_report')
  .addEdge('generate_report',   END)
  .compile()

// 测试
const testCode = `
// Vue3 组件示例
<script setup>
import { ref, onMounted } from 'vue'

const list = ref([])
let timer = null

onMounted(async () => {
  timer = setInterval(async () => {
    const res = await fetch('/api/data')
    list.value = await res.json()
  }, 2000)
})
// 缺少 onUnmounted 清除 timer
</script>
`

const result = await reviewWorkflow.invoke({
  code: testCode,
  language: 'vue3',
})

console.log('\n=== 审查报告 ===')
console.log(result.report.slice(0, 500))
console.log('\n最终评分：', result.score)
