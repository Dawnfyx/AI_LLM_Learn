// 01-basic-workflow/index.js
// 基础线性工作流：固定步骤顺序执行，每步有明确职责
// 场景：文章写作流程 - 选题分析 → 大纲生成 → 内容撰写 → 校对润色
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { ChatPromptTemplate } from '@langchain/core/prompts'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { StateGraph, END, START, Annotation } from '@langchain/langgraph'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0.7,
})

const parser = new StringOutputParser()

// ── 状态定义 ──────────────────────────────────────────────────
const State = Annotation.Root({
  topic:      Annotation({ reducer: (_, n) => n, default: () => '' }),
  audience:   Annotation({ reducer: (_, n) => n, default: () => '前端开发者' }),
  analysis:   Annotation({ reducer: (_, n) => n, default: () => '' }),
  outline:    Annotation({ reducer: (_, n) => n, default: () => '' }),
  draft:      Annotation({ reducer: (_, n) => n, default: () => '' }),
  finalPost:  Annotation({ reducer: (_, n) => n, default: () => '' }),
  wordCounts: Annotation({
    reducer: (a, b) => ({ ...a, ...b }),
    default: () => ({}),
  }),
})

// ── 节点：选题分析 ────────────────────────────────────────────
async function analyzeNode(state) {
  console.log('\n[步骤1] 分析选题...')

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', '你是技术内容策略专家，分析技术文章的受众需求和价值点。回答简洁，100字以内。'],
    ['human', '文章主题：{topic}\n目标读者：{audience}\n\n分析：1) 读者痛点 2) 文章核心价值 3) 差异化角度'],
  ])

  const chain = prompt.pipe(model).pipe(parser)
  const analysis = await chain.invoke({ topic: state.topic, audience: state.audience })

  console.log('  分析完成：', analysis.slice(0, 60) + '...')
  return {
    analysis,
    wordCounts: { analysis: analysis.length },
  }
}

// ── 节点：生成大纲 ────────────────────────────────────────────
async function outlineNode(state) {
  console.log('\n[步骤2] 生成大纲...')

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', '你是技术写作专家，生成清晰的文章大纲。'],
    ['human', `主题：{topic}
受众分析：{analysis}

生成 4-5 个章节的大纲，每章包含标题和 2-3 个要点，格式：
## 章节标题
- 要点1
- 要点2`],
  ])

  const chain = prompt.pipe(model).pipe(parser)
  const outline = await chain.invoke({ topic: state.topic, analysis: state.analysis })

  console.log('  大纲完成：', outline.split('\n').length, '行')
  return {
    outline,
    wordCounts: { outline: outline.length },
  }
}

// ── 节点：撰写草稿 ────────────────────────────────────────────
async function draftNode(state) {
  console.log('\n[步骤3] 撰写草稿...')

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', `你是技术博主，写作风格：口语化、有代码示例、避免空话。
目标读者：${state.audience}`],
    ['human', `根据大纲撰写文章草稿（400-500字）：

主题：{topic}
大纲：
{outline}

要求：每个章节都要有实际代码示例，用 \`\`\`js 包裹`],
  ])

  const chain = prompt.pipe(model).pipe(parser)
  const draft = await chain.invoke({ topic: state.topic, outline: state.outline })

  console.log('  草稿完成：', draft.length, '字')
  return {
    draft,
    wordCounts: { draft: draft.length },
  }
}

// ── 节点：校对润色 ────────────────────────────────────────────
async function polishNode(state) {
  console.log('\n[步骤4] 校对润色...')

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', '你是资深技术编辑，优化文章的可读性和准确性。'],
    ['human', `对以下草稿进行校对润色：
1. 修正技术描述不准确的地方
2. 改善行文流畅度
3. 确保代码示例正确
4. 添加必要的过渡句

草稿：
{draft}`],
  ])

  const chain = prompt.pipe(model).pipe(parser)
  const finalPost = await chain.invoke({ draft: state.draft })

  console.log('  润色完成：', finalPost.length, '字')
  return {
    finalPost,
    wordCounts: { finalPost: finalPost.length },
  }
}

// ── 构建线性工作流 ────────────────────────────────────────────
const writingWorkflow = new StateGraph(State)
  .addNode('analyze', analyzeNode)
  .addNode('outline', outlineNode)
  .addNode('draft',   draftNode)
  .addNode('polish',  polishNode)
  // 线性流：每步顺序执行
  .addEdge(START,     'analyze')
  .addEdge('analyze', 'outline')
  .addEdge('outline', 'draft')
  .addEdge('draft',   'polish')
  .addEdge('polish',   END)
  .compile()

// 执行工作流
console.log('=== 文章写作工作流 ===')

const result = await writingWorkflow.invoke({
  topic: 'Vue3 Composition API 实战指南',
  audience: '有 2 年经验的前端开发者',
})

console.log('\n=== 工作流完成 ===')
console.log('各步骤字数：', result.wordCounts)
console.log('\n最终文章（前300字）：')
console.log(result.finalPost.slice(0, 300) + '...')
