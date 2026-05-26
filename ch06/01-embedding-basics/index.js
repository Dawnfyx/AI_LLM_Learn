// 01-embedding-basics/index.js
// 理解 Embedding：文本 → 向量，向量相似度计算
import 'dotenv/config'
import { OpenAIEmbeddings } from '@langchain/openai'

const embeddings = new OpenAIEmbeddings({
  model: 'text-embedding-3-small',
  apiKey: process.env.OPENAI_API_KEY,
  // 如果用 DeepSeek，DeepSeek 暂无 embedding 模型，需要用 OpenAI
  // 或者换成本地 embedding：见下方 04-rag-advanced
})

// ── 1. 生成单个文本的向量 ─────────────────────────────────────
async function basicEmbedding() {
  console.log('=== 1. 生成向量 ===\n')

  const text = 'Vue3 的响应式系统基于 Proxy 实现'
  const vector = await embeddings.embedQuery(text)

  console.log(`文本：${text}`)
  console.log(`向量维度：${vector.length}`)           // 1536（text-embedding-3-small）
  console.log(`向量前5位：${vector.slice(0, 5).map(v => v.toFixed(4))}`)
  console.log(`向量是一串浮点数，代表文本在高维空间中的位置`)
}

// ── 2. 批量生成向量 ───────────────────────────────────────────
async function batchEmbedding() {
  console.log('\n=== 2. 批量生成向量 ===\n')

  const texts = [
    'Vue3 的响应式系统基于 Proxy',
    'React 使用虚拟 DOM 和 Diff 算法',
    'Node.js 是基于 V8 引擎的 JavaScript 运行时',
    '今天天气不错，适合出去玩',
  ]

  // embedDocuments：批量处理，比逐个调用便宜（批量折扣）
  const vectors = await embeddings.embedDocuments(texts)

  console.log(`批量生成了 ${vectors.length} 个向量`)
  vectors.forEach((v, i) => {
    console.log(`  文本 ${i + 1}：维度 ${v.length}`)
  })
}

// ── 3. 余弦相似度：衡量两个向量的相似程度 ───────────────────
function cosineSimilarity(vecA, vecB) {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < vecA.length; i++) {
    dot   += vecA[i] * vecB[i]
    normA += vecA[i] * vecA[i]
    normB += vecB[i] * vecB[i]
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

async function similarityDemo() {
  console.log('\n=== 3. 向量相似度 ===\n')

  const sentences = [
    'Vue3 组件如何传递 props？',           // 查询句
    'Vue3 中使用 defineProps 接收父组件数据', // 语义相近
    'React 组件的 props 怎么用？',           // 话题相近但框架不同
    '今天股市大涨，科技股表现亮眼',          // 完全无关
  ]

  const vectors = await embeddings.embedDocuments(sentences)
  const queryVec = vectors[0]

  console.log(`查询：${sentences[0]}\n`)
  for (let i = 1; i < sentences.length; i++) {
    const sim = cosineSimilarity(queryVec, vectors[i])
    console.log(`  相似度 ${sim.toFixed(4)}：${sentences[i]}`)
  }

  // 输出示例：
  // 相似度 0.87：Vue3 中使用 defineProps 接收父组件数据  ← 最相似
  // 相似度 0.72：React 组件的 props 怎么用？
  // 相似度 0.21：今天股市大涨...                        ← 最不相似
}

// ── 4. 为什么要用向量数据库而不是关键词搜索 ──────────────────
async function keywordVsSemanticSearch() {
  console.log('\n=== 4. 关键词 vs 语义搜索 ===\n')

  const docs = [
    '使用 v-model 实现双向绑定',
    'defineModel 是 Vue3.4 新增的宏，简化了组件双向绑定的写法',
    'ref 和 reactive 都能创建响应式数据',
  ]

  const query = '怎么让父子组件的数据保持同步？'  // 没有"v-model"关键词

  // 关键词搜索结果（用简单的 includes 模拟）
  const keywordResults = docs.filter(d =>
    query.split(' ').some(word => d.includes(word))
  )
  console.log('关键词搜索结果：', keywordResults.length ? keywordResults : '无结果')

  // 向量语义搜索
  const docVectors = await embeddings.embedDocuments(docs)
  const queryVector = await embeddings.embedQuery(query)

  const similarities = docVectors.map((v, i) => ({
    text: docs[i],
    score: cosineSimilarity(queryVector, v),
  })).sort((a, b) => b.score - a.score)

  console.log('\n语义搜索结果（按相似度排序）：')
  similarities.forEach(s => {
    console.log(`  ${s.score.toFixed(3)} - ${s.text}`)
  })
  // 语义搜索能找到 v-model 相关的文档，即使查询里没有这个词
}

await basicEmbedding()
await batchEmbedding()
await similarityDemo()
await keywordVsSemanticSearch()
