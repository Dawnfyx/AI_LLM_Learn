// 03-rag-chain/index.js
// 完整 RAG 链：文档入库 → 检索相关内容 → 注入 Prompt → 模型生成回答
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { OpenAIEmbeddings } from '@langchain/openai'
import { Chroma } from '@langchain/community/vectorstores/chroma'
import { ChatPromptTemplate } from '@langchain/core/prompts'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { RunnableSequence, RunnablePassthrough } from '@langchain/core/runnables'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { Document } from '@langchain/core/documents'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0.3,
})

const embeddings = new OpenAIEmbeddings({
  model: 'text-embedding-3-small',
  apiKey: process.env.OPENAI_API_KEY,
})

// ── 知识库文档 ────────────────────────────────────────────────
const knowledgeDocs = [
  {
    content: `Vue3 Composition API 核心概念

setup() 函数是 Composition API 的入口，在组件创建时最先执行。
<script setup> 是语法糖，编译后等价于在 setup() 中返回所有顶层变量。

响应式数据：
- ref(value)：基础类型用 ref，在 <template> 中自动解包不需要 .value
- reactive(obj)：对象类型用 reactive，直接访问属性
- toRefs(state)：把 reactive 对象解构，保持响应性

组合函数（Composable）：
把相关的状态和逻辑封装到以 use 开头的函数里，在多个组件间复用。
例如：useFetch、useLocalStorage、useDebounce。`,
    metadata: { source: '官方文档', category: 'composition-api', title: 'Composition API 核心' },
  },
  {
    content: `Vue3 性能优化指南

列表渲染优化：
- v-for 必须加 :key，值要唯一且稳定（不要用数组下标）
- 大列表（超过500条）使用虚拟滚动：vue-virtual-scroller 或 vxe-table

组件级别优化：
- 静态内容用 v-once，只渲染一次
- 频繁更新的组件用 shallowRef / shallowReactive 减少深层响应
- 使用 defineAsyncComponent 懒加载非首屏组件

computed vs methods：
计算属性有缓存，同样的输入不会重复计算。methods 每次都执行。
展示类数据优先用 computed。

<KeepAlive> 缓存组件实例，避免重复创建销毁，适合 Tab 切换场景。`,
    metadata: { source: '最佳实践', category: 'performance', title: 'Vue3 性能优化' },
  },
  {
    content: `Vue Router 4.x 使用指南

基础配置：
import { createRouter, createWebHistory } from 'vue-router'
const router = createRouter({
  history: createWebHistory(),
  routes: [{ path: '/', component: Home }, { path: '/about', component: About }]
})

组合式 API 中使用：
import { useRouter, useRoute } from 'vue-router'
const router = useRouter()  // 路由实例，用于编程式导航
const route = useRoute()    // 当前路由，获取 params/query

导航守卫：
router.beforeEach((to, from) => {
  if (to.meta.requiresAuth && !isLoggedIn()) return '/login'
})

动态路由：path: '/user/:id'，通过 route.params.id 获取。`,
    metadata: { source: '官方文档', category: 'router', title: 'Vue Router 使用' },
  },
]

// ── 初始化向量库 ──────────────────────────────────────────────
async function initVectorStore() {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 400,
    chunkOverlap: 50,
  })

  const docs = []
  for (const kd of knowledgeDocs) {
    const chunks = await splitter.createDocuments(
      [kd.content],
      [kd.metadata]  // 每个 chunk 都继承原文档的 metadata
    )
    docs.push(...chunks)
  }

  console.log(`文档分片完成：${docs.length} 个 chunks`)

  return Chroma.fromDocuments(docs, embeddings, {
    collectionName: 'vue3-knowledge',
    url: process.env.CHROMA_URL || 'http://localhost:8000',
  })
}

// ── 构建 RAG 链 ───────────────────────────────────────────────
function buildRagChain(vectorStore) {
  // 1. Retriever：把向量库封装成检索器
  const retriever = vectorStore.asRetriever({
    k: 3,               // 返回最相似的 3 个文档
    searchType: 'similarity',
  })

  // 2. RAG 提示词模板
  const ragPrompt = ChatPromptTemplate.fromMessages([
    ['system', `你是 Vue3 技术文档助手。根据提供的参考文档回答用户问题。

规则：
- 只基于参考文档回答，不要使用文档外的知识
- 如果文档中没有相关内容，明确说"文档中没有找到相关信息"
- 回答要准确、简洁，可以结合代码示例
- 在回答末尾注明参考来源`],
    ['human', `参考文档：
{context}

用户问题：{question}`],
  ])

  // 3. 格式化检索到的文档
  function formatDocs(docs) {
    return docs
      .map((doc, i) =>
        `[文档${i + 1}] 来源：${doc.metadata.title}（${doc.metadata.source}）\n${doc.pageContent}`
      )
      .join('\n\n---\n\n')
  }

  // 4. 组装 RAG 链
  // RunnablePassthrough 透传 question，同时并行执行 retriever
  const ragChain = RunnableSequence.from([
    {
      context: retriever.pipe(formatDocs),  // 检索 → 格式化
      question: new RunnablePassthrough(),   // 原样透传问题
    },
    ragPrompt,
    model,
    new StringOutputParser(),
  ])

  return ragChain
}

// ── 带溯源的 RAG ─────────────────────────────────────────────
// 不只返回答案，还返回用了哪些文档来生成这个答案
function buildRagChainWithSources(vectorStore) {
  const retriever = vectorStore.asRetriever({ k: 3 })

  const ragPrompt = ChatPromptTemplate.fromMessages([
    ['system', '你是 Vue3 助手，只根据参考文档回答。'],
    ['human', '参考：\n{context}\n\n问题：{question}'],
  ])

  // 分开返回答案和源文档
  const ragChainWithSources = RunnableSequence.from([
    RunnablePassthrough.assign({
      // 检索文档，同时记录下来
      docs: (input) => retriever.invoke(input.question),
    }),
    RunnablePassthrough.assign({
      context: (input) =>
        input.docs.map(d => d.pageContent).join('\n\n'),
    }),
    {
      answer: ragPrompt.pipe(model).pipe(new StringOutputParser()),
      sources: (input) => input.docs.map(d => ({
        title: d.metadata.title,
        source: d.metadata.source,
        category: d.metadata.category,
        preview: d.pageContent.slice(0, 80) + '...',
      })),
    },
  ])

  return ragChainWithSources
}

// ── 测试 ─────────────────────────────────────────────────────
async function main() {
  let vectorStore
  try {
    vectorStore = await initVectorStore()
  } catch (e) {
    console.error('需要启动 Chroma：docker run -d -p 8000:8000 chromadb/chroma')
    process.exit(1)
  }

  const ragChain = buildRagChain(vectorStore)
  const ragWithSources = buildRagChainWithSources(vectorStore)

  const questions = [
    'setup() 和 <script setup> 有什么区别？',
    '大量列表数据怎么优化渲染性能？',
    '如何在 Composition API 里获取当前路由参数？',
    '什么是响应式，怎么用 ref？',          // 文档内有答案
    'Nuxt3 和 Vue3 有什么区别？',           // 文档内没有答案
  ]

  for (const q of questions) {
    console.log('\n' + '─'.repeat(55))
    console.log('问题：', q)

    // 普通 RAG
    const answer = await ragChain.invoke(q)
    console.log('回答：', answer.slice(0, 200) + '...')
  }

  // 带溯源的 RAG
  console.log('\n\n=== 带溯源的 RAG ===\n')
  const result = await ragWithSources.invoke({
    question: 'Vue3 里 computed 和 methods 有什么区别，什么时候用哪个？',
  })
  console.log('回答：', result.answer.slice(0, 200))
  console.log('\n引用来源：')
  result.sources.forEach((s, i) => {
    console.log(`  [${i + 1}] ${s.title}（${s.source}）：${s.preview}`)
  })
}

main()
