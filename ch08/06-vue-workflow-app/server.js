// 06-vue-workflow-app/server.js
// 工作流应用服务端：内容生成工作流，SSE 实时推送每个节点的执行状态
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { ChatOpenAI } from '@langchain/openai'
import { ChatPromptTemplate } from '@langchain/core/prompts'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { StateGraph, END, START, Annotation } from '@langchain/langgraph'
import { MemorySaver } from '@langchain/langgraph'
import { z } from 'zod'

const app = express()
app.use(cors())
app.use(express.json())

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0.7,
  streaming: true,
})

const checkpointer = new MemorySaver()

// ── 工作流定义：技术文章生成 ─────────────────────────────────
const State = Annotation.Root({
  topic:       Annotation({ reducer: (_, n) => n, default: () => '' }),
  audience:    Annotation({ reducer: (_, n) => n, default: () => '前端开发者' }),
  keywords:    Annotation({ reducer: (_, n) => n, default: () => [] }),
  outline:     Annotation({ reducer: (_, n) => n, default: () => '' }),
  draft:       Annotation({ reducer: (_, n) => n, default: () => '' }),
  seoScore:    Annotation({ reducer: (_, n) => n, default: () => 0 }),
  finalPost:   Annotation({ reducer: (_, n) => n, default: () => '' }),
})

function buildWorkflow(sendEvent) {
  const parser = new StringOutputParser()

  async function keywordsNode(state) {
    sendEvent('node_start', { node: 'keywords', label: '关键词提取' })
    const res = await model.invoke([
      { role: 'system', content: '提取文章关键词和 SEO 词，输出 JSON 数组，5-8个。只输出 JSON。' },
      { role: 'user', content: `主题：${state.topic}` },
    ])
    const kws = JSON.parse(res.content.replace(/```json\n?|\n?```/g, '').trim())
    sendEvent('node_done', { node: 'keywords', result: kws })
    return { keywords: kws }
  }

  async function outlineNode(state) {
    sendEvent('node_start', { node: 'outline', label: '大纲生成' })
    const res = await ChatPromptTemplate.fromMessages([
      ['system', '技术写作专家，生成清晰的文章大纲，4个章节。'],
      ['human', '主题：{topic}\n关键词：{kws}\n受众：{audience}\n\n生成大纲（带各章要点）：'],
    ]).pipe(model).pipe(parser).invoke({
      topic: state.topic,
      kws: state.keywords.join(', '),
      audience: state.audience,
    })
    sendEvent('node_done', { node: 'outline', result: res.slice(0, 100) + '...' })
    return { outline: res }
  }

  async function draftNode(state) {
    sendEvent('node_start', { node: 'draft', label: '内容撰写' })
    let draft = ''
    const stream = await ChatPromptTemplate.fromMessages([
      ['system', `技术博主，写给${state.audience}看，风格：实用、有代码示例、避免废话。`],
      ['human', '主题：{topic}\n大纲：{outline}\n\n按大纲写文章草稿（300字，含代码示例）：'],
    ]).pipe(model).pipe(parser).stream({ topic: state.topic, outline: state.outline })

    for await (const chunk of stream) {
      draft += chunk
      sendEvent('token', { node: 'draft', token: chunk })
    }
    sendEvent('node_done', { node: 'draft', result: `${draft.length}字` })
    return { draft }
  }

  async function seoCheckNode(state) {
    sendEvent('node_start', { node: 'seo', label: 'SEO 检查' })

    const SeoSchema = z.object({
      score: z.number().min(0).max(100),
      issues: z.array(z.string()),
    })
    const seoModel = model.withStructuredOutput(SeoSchema)
    const result = await seoModel.invoke([
      { role: 'system', content: 'SEO专家，评估文章SEO质量，0-100分。' },
      { role: 'user', content: `文章：${state.draft}\n关键词：${state.keywords.join(', ')}` },
    ])

    sendEvent('node_done', { node: 'seo', result: `${result.score}分` })
    return { seoScore: result.score }
  }

  async function polishNode(state) {
    sendEvent('node_start', { node: 'polish', label: '润色发布' })
    const res = await ChatPromptTemplate.fromMessages([
      ['system', '文章编辑，优化可读性，确保关键词自然融入。'],
      ['human', '原文：{draft}\n关键词：{kws}\n\n优化后的版本：'],
    ]).pipe(model).pipe(parser).invoke({ draft: state.draft, kws: state.keywords.join(', ') })
    sendEvent('node_done', { node: 'polish', result: `最终${res.length}字` })
    return { finalPost: res }
  }

  return new StateGraph(State)
    .addNode('keywords', keywordsNode)
    .addNode('outline',  outlineNode)
    .addNode('draft',    draftNode)
    .addNode('seo',      seoCheckNode)
    .addNode('polish',   polishNode)
    .addEdge(START,       'keywords')
    .addEdge('keywords',  'outline')
    .addEdge('outline',   'draft')
    .addEdge('draft',     'seo')
    .addEdge('seo',       'polish')
    .addEdge('polish',     END)
    .compile({ checkpointer })
}

// ── API：执行工作流（SSE 流式输出）───────────────────────────
app.post('/api/workflow/run', async (req, res) => {
  const { topic, audience = '前端开发者' } = req.body
  if (!topic?.trim()) return res.status(400).json({ error: '主题不能为空' })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const send = (event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  const threadId = `workflow_${Date.now()}`

  try {
    send('start', { threadId, topic })

    const workflow = buildWorkflow(send)
    const result = await workflow.invoke(
      { topic, audience },
      { configurable: { thread_id: threadId } }
    )

    send('complete', {
      seoScore: result.seoScore,
      wordCount: result.finalPost?.length,
      keywords: result.keywords,
    })
  } catch (e) {
    send('error', { message: e.message })
  } finally {
    res.end()
  }
})

// ── API：工作流模板列表 ───────────────────────────────────────
app.get('/api/workflow/templates', (req, res) => {
  res.json({
    templates: [
      {
        id: 'article',
        name: '技术文章生成',
        nodes: ['keywords', 'outline', 'draft', 'seo', 'polish'],
        desc: '从主题到发布的完整文章生成流程',
      },
      {
        id: 'code-review',
        name: '代码审查',
        nodes: ['classify', 'review', 'report'],
        desc: '自动化代码审查和报告生成',
      },
    ],
  })
})

app.get('/health', (req, res) => res.json({ status: 'ok' }))

app.listen(3000, () => console.log('工作流服务已启动：http://localhost:3000'))
