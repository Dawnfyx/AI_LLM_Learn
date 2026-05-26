// 03-parallel-workflow/index.js
// 并行工作流：多个节点同时执行，汇聚结果
// 场景：前端项目全面分析 - 性能/可访问性/SEO/安全 并行检测
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { ChatPromptTemplate } from '@langchain/core/prompts'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { StateGraph, END, START, Annotation } from '@langchain/langgraph'
import { RunnableParallel } from '@langchain/core/runnables'
import { z } from 'zod'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0,
})

const parser = new StringOutputParser()

// ── 方式一：LangGraph 并行节点（Send API）────────────────────
// LangGraph 通过 Send 实现并行：把同一批数据分发给多个节点同时处理

const State = Annotation.Root({
  projectInfo:    Annotation({ reducer: (_, n) => n, default: () => ({}) }),
  analysisType:   Annotation({ reducer: (_, n) => n, default: () => '' }),
  // 各维度分析结果（累加型 reducer）
  analyses: Annotation({
    reducer: (existing, newVal) => ({ ...existing, ...newVal }),
    default: () => ({}),
  }),
  finalReport:  Annotation({ reducer: (_, n) => n, default: () => '' }),
  overallScore: Annotation({ reducer: (_, n) => n, default: () => 0 }),
})

// ── 方式二：RunnableParallel（更简洁，适合无状态并行）────────
async function parallelAnalysisWithRunnables(projectInfo) {
  console.log('=== 方式一：RunnableParallel ===\n')

  const makeAnalyzer = (role, focus) =>
    ChatPromptTemplate.fromMessages([
      ['system', `你是${role}专家，分析前端项目的${focus}。回答简洁，不超过150字。`],
      ['human', '项目信息：{info}\n\n分析主要问题和建议，输出 JSON：{"score":number,"issues":string[],"suggestions":string[]}'],
    ]).pipe(model).pipe(parser)

  const start = Date.now()

  // 4 个分析器同时执行
  const result = await RunnableParallel.from({
    performance:   makeAnalyzer('性能', '加载速度和运行效率'),
    accessibility: makeAnalyzer('可访问性', 'WCAG 标准和无障碍'),
    seo:           makeAnalyzer('SEO', '搜索引擎优化'),
    security:      makeAnalyzer('安全', '前端安全漏洞'),
  }).invoke({ info: JSON.stringify(projectInfo) })

  console.log(`并行执行耗时：${Date.now() - start}ms（4 个分析器同时运行）`)

  const parseResult = (text) => {
    try { return JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim()) }
    catch { return { score: 0, issues: [], suggestions: [] } }
  }

  return {
    performance:   parseResult(result.performance),
    accessibility: parseResult(result.accessibility),
    seo:           parseResult(result.seo),
    security:      parseResult(result.security),
  }
}

// ── 方式三：LangGraph 中的并行节点 ───────────────────────────
// 多个节点同时执行，然后汇聚到一个节点

const ParallelState = Annotation.Root({
  input:       Annotation({ reducer: (_, n) => n, default: () => '' }),
  perfResult:  Annotation({ reducer: (_, n) => n, default: () => '' }),
  a11yResult:  Annotation({ reducer: (_, n) => n, default: () => '' }),
  seoResult:   Annotation({ reducer: (_, n) => n, default: () => '' }),
  finalReport: Annotation({ reducer: (_, n) => n, default: () => '' }),
})

// 三个并行节点
async function perfNode(state) {
  const res = await model.invoke([
    { role: 'system', content: '前端性能专家，分析性能问题' },
    { role: 'user', content: `分析性能问题（100字内）：${state.input}` },
  ])
  return { perfResult: res.content }
}

async function a11yNode(state) {
  const res = await model.invoke([
    { role: 'system', content: '可访问性专家，分析 WCAG 合规性' },
    { role: 'user', content: `分析可访问性问题（100字内）：${state.input}` },
  ])
  return { a11yResult: res.content }
}

async function seoNode(state) {
  const res = await model.invoke([
    { role: 'system', content: 'SEO 专家，分析搜索引擎优化' },
    { role: 'user', content: `分析 SEO 问题（100字内）：${state.input}` },
  ])
  return { seoResult: res.content }
}

// 汇聚节点：等所有并行节点完成后执行
async function mergeNode(state) {
  console.log('\n[汇聚] 整合所有分析结果...')

  const report = await model.invoke([
    { role: 'system', content: '技术报告专家，整合多维度分析结果' },
    { role: 'user', content: `整合以下分析，生成优先级排序的行动清单：

**性能：** ${state.perfResult}
**可访问性：** ${state.a11yResult}
**SEO：** ${state.seoResult}

输出：按优先级排序的 5 条改进建议` },
  ])

  return { finalReport: report.content }
}

// 构建并行工作流
// 关键：从 START 同时连接三个节点，这三个节点会并行执行
// 三个节点都连接到 merge，LangGraph 会等三个都完成才执行 merge
const parallelWorkflow = new StateGraph(ParallelState)
  .addNode('perf', perfNode)
  .addNode('a11y', a11yNode)
  .addNode('seo',  seoNode)
  .addNode('merge', mergeNode)
  .addEdge(START, 'perf')    // 同时启动三个节点
  .addEdge(START, 'a11y')
  .addEdge(START, 'seo')
  .addEdge('perf', 'merge')  // 三个节点都连到 merge
  .addEdge('a11y', 'merge')  // merge 等待所有前置节点完成
  .addEdge('seo',  'merge')
  .addEdge('merge', END)
  .compile()

// 测试
const projectDesc = `
前端项目信息：
- 框架：Vue3 + Vite
- 页面数：15个
- 主要问题：首页 LCP 4.2s，图片未压缩，无 alt 属性，meta description 缺失
- 代码中有内联事件处理器（onclick），localStorage 存储了用户 token
`

console.log('=== 并行工作流测试 ===\n')

// 测试 RunnableParallel
const analysisResult = await parallelAnalysisWithRunnables({ desc: projectDesc })
console.log('\n各维度评分：')
Object.entries(analysisResult).forEach(([key, val]) => {
  console.log(`  ${key}: ${val.score}/100`)
})

// 测试 LangGraph 并行
console.log('\n=== LangGraph 并行节点 ===')
const start = Date.now()
const graphResult = await parallelWorkflow.invoke({ input: projectDesc })
console.log(`耗时: ${Date.now() - start}ms`)
console.log('综合报告：', graphResult.finalReport.slice(0, 300))
