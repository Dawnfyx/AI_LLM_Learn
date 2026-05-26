// 04-rag-advanced/index.js
// 进阶 RAG：查询改写、混合检索、多路召回、重排序
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { OpenAIEmbeddings } from '@langchain/openai'
import { Chroma } from '@langchain/community/vectorstores/chroma'
import { ChatPromptTemplate } from '@langchain/core/prompts'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { Document } from '@langchain/core/documents'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0,
})

const embeddings = new OpenAIEmbeddings({
  model: 'text-embedding-3-small',
  apiKey: process.env.OPENAI_API_KEY,
})

// ── 技巧1：查询改写（Query Rewriting）────────────────────────
// 用户的问题往往口语化、不完整，先让模型改写成更适合检索的形式
async function queryRewriting(userQuestion) {
  console.log('\n=== 技巧1：查询改写 ===')

  const rewritePrompt = ChatPromptTemplate.fromMessages([
    ['system', `你是检索优化专家。将用户的口语化问题改写成更适合文档检索的查询语句。
要求：
- 提取核心技术关键词
- 补充可能的相关概念
- 输出 3 个不同角度的查询，每行一个，不加编号`],
    ['human', '用户问题：{question}'],
  ])

  const chain = rewritePrompt.pipe(model).pipe(new StringOutputParser())
  const result = await chain.invoke({ question: userQuestion })

  const queries = result.split('\n').filter(q => q.trim())

  console.log(`原始问题：${userQuestion}`)
  console.log('改写后的查询：')
  queries.forEach(q => console.log(`  - ${q}`))

  return queries
}

// ── 技巧2：多路召回（Multi-Query Retrieval）───────────────────
// 用多个查询分别检索，合并去重，覆盖更多相关文档
async function multiQueryRetrieval(vectorStore, questions) {
  console.log('\n=== 技巧2：多路召回 ===')

  const allDocs = new Map()  // 用 Map 自动去重（key=内容）

  for (const q of questions) {
    const docs = await vectorStore.similaritySearch(q, 3)
    docs.forEach(doc => {
      const key = doc.pageContent.slice(0, 50)
      if (!allDocs.has(key)) {
        allDocs.set(key, doc)
      }
    })
  }

  const uniqueDocs = [...allDocs.values()]
  console.log(`${questions.length} 个查询，召回 ${uniqueDocs.length} 个不重复文档`)
  return uniqueDocs
}

// ── 技巧3：重排序（Reranking）─────────────────────────────────
// 检索召回后，用模型对文档和问题的相关性打分，取最相关的
async function rerank(question, docs, topK = 3) {
  console.log('\n=== 技巧3：重排序 ===')

  const rerankPrompt = ChatPromptTemplate.fromMessages([
    ['system', `对文档和问题的相关性打分（0-10），只输出数字，不要其他内容。
10=完全回答了问题，5=部分相关，0=完全无关`],
    ['human', `问题：{question}\n\n文档：{doc}`],
  ])

  const chain = rerankPrompt.pipe(model).pipe(new StringOutputParser())

  const scored = await Promise.all(
    docs.map(async (doc) => {
      const scoreStr = await chain.invoke({
        question,
        doc: doc.pageContent.slice(0, 300),
      })
      const score = parseFloat(scoreStr.trim()) || 0
      return { doc, score }
    })
  )

  const reranked = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)

  console.log('重排序结果：')
  reranked.forEach(({ doc, score }) => {
    console.log(`  分数 ${score}：${doc.pageContent.slice(0, 60)}...`)
  })

  return reranked.map(r => r.doc)
}

// ── 技巧4：对话历史感知检索（Contextual Compression）──────────
// 多轮对话里，用户的问题可能依赖上下文，需要结合历史理解
async function contextualRetrieval(vectorStore) {
  console.log('\n=== 技巧4：对话历史感知检索 ===')

  const chatHistory = [
    { role: 'user', content: '我在做一个 Vue3 项目' },
    { role: 'assistant', content: '好的，Vue3 项目中有什么可以帮你？' },
  ]
  const currentQuestion = '怎么让组件只渲染一次，提高性能？'  // 依赖上下文才知道是 Vue3

  // 先把当前问题结合历史，生成一个完整的独立查询
  const contextualizePrompt = ChatPromptTemplate.fromMessages([
    ['system', `根据对话历史，将用户的最新问题改写成一个独立的、完整的问题。
如果问题本身已经完整，直接返回原问题。只输出改写后的问题，不加解释。`],
    ['human', `对话历史：
${chatHistory.map(m => `${m.role === 'user' ? '用户' : '助手'}：${m.content}`).join('\n')}

最新问题：${currentQuestion}`],
  ])

  const standaloneChain = contextualizePrompt.pipe(model).pipe(new StringOutputParser())
  const standaloneQ = await standaloneChain.invoke({})

  console.log(`原始问题：${currentQuestion}`)
  console.log(`独立化后：${standaloneQ}`)

  // 用独立化后的问题去检索
  const docs = await vectorStore.similaritySearch(standaloneQ, 3)
  console.log(`检索到 ${docs.length} 个相关文档`)
  return docs
}

// ── 技巧5：混合检索（BM25 + 向量）────────────────────────────
// 关键词匹配擅长精确词汇，向量搜索擅长语义，两者结合效果更好
function bm25Score(query, document) {
  // 简化版 BM25（生产用 elasticsearch 或 typesense）
  const k1 = 1.5, b = 0.75
  const queryTerms = query.toLowerCase().split(/\s+/)
  const docTerms = document.toLowerCase().split(/\s+/)
  const docLen = docTerms.length
  const avgDocLen = 100  // 假设平均文档长度

  let score = 0
  for (const term of queryTerms) {
    const tf = docTerms.filter(t => t.includes(term)).length
    if (tf === 0) continue
    const idf = Math.log((1 + 1) / (0.5 + 1)) + 1  // 简化 IDF
    score += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * docLen / avgDocLen))
  }
  return score
}

async function hybridSearch(vectorStore, query, docs) {
  console.log('\n=== 技巧5：混合检索 ===')

  // 向量检索
  const vectorDocs = await vectorStore.similaritySearchWithScore(query, 5)

  // BM25 关键词检索
  const bm25Scored = docs.map(doc => ({
    doc,
    bm25: bm25Score(query, doc.pageContent),
  })).sort((a, b) => b.bm25 - a.bm25).slice(0, 5)

  // 合并两种结果（RRF：Reciprocal Rank Fusion）
  const allDocs = new Map()

  vectorDocs.forEach(([doc, score], rank) => {
    const key = doc.pageContent.slice(0, 50)
    const rrfScore = 1 / (rank + 60)
    allDocs.set(key, { doc, score: rrfScore })
  })

  bm25Scored.forEach(({ doc, bm25 }, rank) => {
    const key = doc.pageContent.slice(0, 50)
    const rrfScore = 1 / (rank + 60)
    const existing = allDocs.get(key)
    if (existing) {
      existing.score += rrfScore  // 两种方法都找到了，分数叠加
    } else {
      allDocs.set(key, { doc, score: rrfScore })
    }
  })

  const results = [...allDocs.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)

  console.log(`混合检索结果（向量+BM25）：`)
  results.forEach(({ doc, score }) => {
    console.log(`  RRF分数 ${score.toFixed(4)}：${doc.pageContent.slice(0, 60)}...`)
  })

  return results.map(r => r.doc)
}

async function main() {
  // 初始化向量库（同第三章数据）
  let vectorStore
  try {
    vectorStore = await Chroma.fromExistingCollection(embeddings, {
      collectionName: 'vue3-knowledge',
      url: process.env.CHROMA_URL || 'http://localhost:8000',
    })
    console.log('✓ 连接到现有向量库')
  } catch {
    console.log('向量库不存在，先运行 03-rag-chain/index.js 初始化')
    return
  }

  const question = '列表渲染1000条数据，页面很卡，怎么优化？'

  // 1. 查询改写
  const rewrittenQueries = await queryRewriting(question)

  // 2. 多路召回
  const allDocs = await multiQueryRetrieval(vectorStore, [question, ...rewrittenQueries])

  // 3. 重排序
  const topDocs = await rerank(question, allDocs)

  // 4. 对话历史感知
  await contextualRetrieval(vectorStore)

  // 5. 混合检索（需要原始文档列表）
  // await hybridSearch(vectorStore, question, allDocs)
}

main()
