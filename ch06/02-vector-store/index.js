// 02-vector-store/index.js
// 向量数据库：文档存入 Chroma，语义检索
// 前置：docker run -d -p 8000:8000 chromadb/chroma
import 'dotenv/config'
import { OpenAIEmbeddings } from '@langchain/openai'
import { Chroma } from '@langchain/community/vectorstores/chroma'
import { Document } from '@langchain/core/documents'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'

const embeddings = new OpenAIEmbeddings({
  model: 'text-embedding-3-small',
  apiKey: process.env.OPENAI_API_KEY,
})

// ── 1. 创建向量库并添加文档 ──────────────────────────────────
async function buildVectorStore() {
  console.log('=== 1. 创建向量库 ===\n')

  // 模拟前端技术文档
  const documents = [
    new Document({
      pageContent: `Vue3 响应式基础
ref() 用于基础类型，通过 .value 访问。reactive() 用于对象，直接访问属性。
computed() 创建派生状态，自动缓存，依赖变化才重新计算。
watch() 侦听特定数据变化，watchEffect() 自动追踪依赖。`,
      metadata: { source: 'vue3-guide', category: 'reactivity', page: 1 },
    }),
    new Document({
      pageContent: `Vue3 组件通信
父传子：defineProps() 接收数据。子传父：defineEmits() 触发事件。
跨层级：provide/inject，祖先组件 provide，后代组件 inject。
兄弟组件：用 Pinia 全局状态，或者事件总线（mitt）。
v-model：父子双向绑定，等价于 :modelValue + @update:modelValue。`,
      metadata: { source: 'vue3-guide', category: 'components', page: 2 },
    }),
    new Document({
      pageContent: `Vue3 生命周期钩子
setup() 最先执行，替代了 beforeCreate 和 created。
onMounted()：组件挂载后，可以访问 DOM，适合发请求、初始化第三方库。
onUnmounted()：组件销毁前，必须在这里清理定时器、取消事件监听，否则内存泄漏。
onBeforeUpdate() / onUpdated()：数据更新前后的钩子。`,
      metadata: { source: 'vue3-guide', category: 'lifecycle', page: 3 },
    }),
    new Document({
      pageContent: `Pinia 状态管理
defineStore() 定义 store，接受 id 和选项对象。
state：存储数据（等同于 data）。
getters：计算派生数据（等同于 computed）。
actions：方法，可以是异步的（等同于 methods）。
比 Vuex 更简洁，支持 TypeScript，支持组合式写法（Setup Store）。`,
      metadata: { source: 'pinia-guide', category: 'state', page: 1 },
    }),
    new Document({
      pageContent: `Vite 构建工具
Vite 利用浏览器原生 ES Module，开发时按需编译，冷启动速度极快（毫秒级）。
HMR（热模块替换）只更新修改的模块，不刷新整页。
生产构建使用 Rollup，Tree Shaking 自动移除未使用代码。
vite.config.js 配置：plugins、resolve.alias、server.proxy、build.outDir 等。`,
      metadata: { source: 'vite-guide', category: 'tooling', page: 1 },
    }),
  ]

  // 创建向量库，自动生成每个文档的 embedding 并存入 Chroma
  const vectorStore = await Chroma.fromDocuments(documents, embeddings, {
    collectionName: 'frontend-docs',
    url: process.env.CHROMA_URL || 'http://localhost:8000',
  })

  console.log(`✓ 已存入 ${documents.length} 个文档`)
  return vectorStore
}

// ── 2. 基础检索 ───────────────────────────────────────────────
async function basicRetrieval(vectorStore) {
  console.log('\n=== 2. 基础检索 ===\n')

  const queries = [
    '组件之间怎么传数据？',
    '页面加载后怎么发请求？',
    '定时器在哪里清除？',
  ]

  for (const query of queries) {
    // similaritySearch：返回最相似的 k 个文档
    const docs = await vectorStore.similaritySearch(query, 2)
    console.log(`查询：${query}`)
    docs.forEach((doc, i) => {
      console.log(`  结果${i + 1} [${doc.metadata.category}]: ${doc.pageContent.slice(0, 60)}...`)
    })
    console.log()
  }
}

// ── 3. 带分数的检索 ───────────────────────────────────────────
async function retrievalWithScore(vectorStore) {
  console.log('\n=== 3. 带相似度分数 ===\n')

  const query = 'Pinia 和 Vuex 有什么区别？'
  const results = await vectorStore.similaritySearchWithScore(query, 3)

  console.log(`查询：${query}`)
  results.forEach(([doc, score]) => {
    console.log(`  分数 ${score.toFixed(4)} [${doc.metadata.source}]: ${doc.pageContent.slice(0, 60)}...`)
  })
}

// ── 4. 带过滤条件的检索 ───────────────────────────────────────
async function filteredRetrieval(vectorStore) {
  console.log('\n=== 4. 带元数据过滤 ===\n')

  // 只在 vue3-guide 这个来源里搜索
  const docs = await vectorStore.similaritySearch(
    '数据变化怎么监听？',
    3,
    { source: 'vue3-guide' }  // filter：按 metadata 过滤
  )

  console.log('只搜索 vue3-guide 的结果：')
  docs.forEach(doc => {
    console.log(`  [${doc.metadata.category}] ${doc.pageContent.slice(0, 60)}...`)
  })
}

// ── 5. 文档分片（大文档拆小） ────────────────────────────────
async function chunkingDemo() {
  console.log('\n=== 5. 文档分片 ===\n')

  const longDoc = `
# Vue3 完整指南

## 第一节：响应式
Vue3 的响应式系统基于 ES6 Proxy 实现，取代了 Vue2 的 Object.defineProperty。
ref() 适合基础类型，reactive() 适合对象和数组。
computed() 具有缓存效果，只有依赖的响应式数据变化时才重新计算。

## 第二节：组件
组件是 Vue3 的核心概念，通过 <script setup> 语法糖简化代码。
defineProps 声明接收的属性，defineEmits 声明可触发的事件。
Teleport 可以将组件渲染到 DOM 的任意位置，常用于 Modal 和 Toast。

## 第三节：路由
Vue Router 4.x 与 Vue3 深度集成，支持组合式 API。
useRouter() 获取路由实例，useRoute() 获取当前路由信息。
动态路由、嵌套路由、路由守卫是三个核心概念。
`.trim()

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 200,      // 每个分片最多 200 字符
    chunkOverlap: 30,    // 相邻分片重叠 30 字符（防止语义断裂）
    separators: ['\n\n', '\n', '。', '，', ' ', ''],  // 按优先级尝试分割
  })

  const chunks = await splitter.createDocuments([longDoc])
  console.log(`原文 ${longDoc.length} 字符 → 分成 ${chunks.length} 个分片：`)
  chunks.forEach((chunk, i) => {
    console.log(`  [${i + 1}] ${chunk.pageContent.length} 字符: ${chunk.pageContent.slice(0, 50)}...`)
  })
}

// 运行所有示例
try {
  const vectorStore = await buildVectorStore()
  await basicRetrieval(vectorStore)
  await retrievalWithScore(vectorStore)
  await filteredRetrieval(vectorStore)
} catch (e) {
  console.error('需要启动 Chroma：docker run -d -p 8000:8000 chromadb/chroma')
  console.error(e.message)
}

await chunkingDemo()
