// 05-vue-rag-app/server.js
// 带知识库管理的完整 RAG 服务端
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import multer from 'multer'
import { ChatOpenAI } from '@langchain/openai'
import { OpenAIEmbeddings } from '@langchain/openai'
import { Chroma } from '@langchain/community/vectorstores/chroma'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { ChatPromptTemplate } from '@langchain/core/prompts'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { RunnablePassthrough } from '@langchain/core/runnables'
import { Document } from '@langchain/core/documents'

const app = express()
app.use(cors())
app.use(express.json())
const upload = multer({ storage: multer.memoryStorage() })

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0.3,
  streaming: true,
})

const embeddings = new OpenAIEmbeddings({
  model: 'text-embedding-3-small',
  apiKey: process.env.OPENAI_API_KEY,
})

const CHROMA_URL = process.env.CHROMA_URL || 'http://localhost:8000'
const COLLECTION = 'rag-knowledge-base'

// 文档元数据存储（生产用数据库）
const docRegistry = new Map()

// ── 获取/初始化向量库 ─────────────────────────────────────────
let vectorStore = null
async function getVectorStore() {
  if (vectorStore) return vectorStore
  try {
    vectorStore = await Chroma.fromExistingCollection(embeddings, {
      collectionName: COLLECTION, url: CHROMA_URL,
    })
  } catch {
    // 不存在则创建空的
    vectorStore = new Chroma(embeddings, { collectionName: COLLECTION, url: CHROMA_URL })
  }
  return vectorStore
}

// ── API：上传文档 ─────────────────────────────────────────────
app.post('/api/documents', upload.single('file'), async (req, res) => {
  try {
    const { title, category = 'general' } = req.body
    const content = req.file
      ? req.file.buffer.toString('utf-8')
      : req.body.content

    if (!content) return res.status(400).json({ error: '缺少文档内容' })

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 500, chunkOverlap: 50,
    })

    const docId = `doc_${Date.now()}`
    const chunks = await splitter.createDocuments(
      [content],
      [{ docId, title: title || '未命名文档', category, uploadedAt: new Date().toISOString() }]
    )

    const vs = await getVectorStore()
    await vs.addDocuments(chunks)

    docRegistry.set(docId, {
      id: docId, title: title || '未命名文档',
      category, chunks: chunks.length,
      uploadedAt: new Date().toISOString(),
      preview: content.slice(0, 100),
    })

    res.json({ success: true, docId, chunks: chunks.length })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── API：文档列表 ─────────────────────────────────────────────
app.get('/api/documents', (req, res) => {
  res.json({ documents: [...docRegistry.values()] })
})

// ── API：删除文档 ─────────────────────────────────────────────
app.delete('/api/documents/:docId', async (req, res) => {
  const { docId } = req.params
  const vs = await getVectorStore()
  await vs.delete({ filter: { docId } })
  docRegistry.delete(docId)
  res.json({ success: true })
})

// ── API：RAG 问答（流式）──────────────────────────────────────
app.post('/api/chat/stream', async (req, res) => {
  const { question, category } = req.body
  if (!question?.trim()) return res.status(400).json({ error: '问题不能为空' })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const send = (event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  try {
    const vs = await getVectorStore()

    // 检索相关文档
    send('status', { message: '正在检索相关文档...' })
    const filter = category ? { category } : undefined
    const docs = await vs.similaritySearchWithScore(question, 4, filter)

    const relevantDocs = docs.filter(([, score]) => score > 0.4)
    send('sources', {
      sources: relevantDocs.map(([doc, score]) => ({
        title: doc.metadata.title,
        category: doc.metadata.category,
        score: score.toFixed(3),
        preview: doc.pageContent.slice(0, 80),
      })),
    })

    if (relevantDocs.length === 0) {
      send('token', { token: '抱歉，知识库中没有找到与您问题相关的内容。请尝试上传相关文档后再提问。' })
      send('done', {})
      res.end()
      return
    }

    const context = relevantDocs
      .map(([doc, score], i) =>
        `[参考${i + 1}] ${doc.metadata.title}\n${doc.pageContent}`
      )
      .join('\n\n---\n\n')

    // 流式生成回答
    send('status', { message: '正在生成回答...' })

    const prompt = ChatPromptTemplate.fromMessages([
      ['system', `你是知识库问答助手。严格根据以下参考文档回答，不要使用文档之外的知识。
如果文档内容不足以回答，请明确说明。回答要准确、简洁。`],
      ['human', `参考文档：\n{context}\n\n问题：{question}`],
    ])

    const chain = prompt.pipe(model).pipe(new StringOutputParser())
    const stream = await chain.stream({ context, question })

    for await (const chunk of stream) {
      send('token', { token: chunk })
    }

    send('done', {})
  } catch (e) {
    send('error', { message: e.message })
  } finally {
    res.end()
  }
})

// ── API：健康检查 ─────────────────────────────────────────────
app.get('/health', async (req, res) => {
  let chromaOk = false
  try {
    await getVectorStore()
    chromaOk = true
  } catch {}
  res.json({ status: 'ok', chroma: chromaOk, documents: docRegistry.size })
})

app.listen(3000, () => {
  console.log('RAG 服务已启动：http://localhost:3000')
  console.log('前置依赖：docker run -d -p 8000:8000 chromadb/chroma')
})
