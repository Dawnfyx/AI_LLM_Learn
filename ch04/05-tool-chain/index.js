// 05-tool-chain/index.js
// 用 LangGraph ToolNode 简化工具调用循环
// LangGraph 的 ToolNode 自动处理工具调用，不需要手写 for 循环
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { StateGraph, END, START, Annotation, messagesStateReducer } from '@langchain/langgraph'
import { ToolNode } from '@langchain/langgraph/prebuilt'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0,
})

// ── 工具定义 ──────────────────────────────────────────────────

const searchPackageTool = tool(
  async ({ query }) => {
    // 模拟搜索 npm 包
    const results = {
      'state management vue': ['pinia@2.2', 'vuex@4.1', 'valtio@1.13'],
      'http client': ['axios@1.7', 'ky@1.7', 'got@14.4'],
      'date utility': ['dayjs@1.11', 'date-fns@3.6', 'luxon@3.5'],
      'form validation': ['vee-validate@4.13', 'vuelidate@2.0', 'zod@3.23'],
      'testing': ['vitest@2.0', 'jest@29.7', 'playwright@1.46'],
    }
    const key = Object.keys(results).find(k =>
      query.toLowerCase().includes(k.split(' ')[0]) ||
      k.includes(query.toLowerCase())
    )
    return JSON.stringify({
      query,
      results: key ? results[key] : ['未找到相关包，请尝试其他关键词'],
    })
  },
  {
    name: 'search_package',
    description: '搜索 npm 包，根据功能描述找到相关的包',
    schema: z.object({ query: z.string().describe('搜索关键词，如"state management vue"') }),
  }
)

const getPackageDetailsTool = tool(
  async ({ packageName }) => {
    const details = {
      'pinia': {
        weeklyDownloads: '4.5M', stars: '12.8k', lastUpdate: '2天前',
        pros: ['官方推荐', 'TypeScript 友好', 'Devtools 支持', '模块化设计'],
        cons: ['生态不如 Vuex 成熟'],
        installCmd: 'npm install pinia',
        quickStart: `import { defineStore } from 'pinia'\nexport const useCounterStore = defineStore('counter', () => {\n  const count = ref(0)\n  return { count }\n})`,
      },
      'axios': {
        weeklyDownloads: '58M', stars: '104k', lastUpdate: '1周前',
        pros: ['拦截器', '自动转换 JSON', '取消请求', '浏览器+Node.js 支持'],
        cons: ['包体积较大（约16kb gzipped）'],
        installCmd: 'npm install axios',
        quickStart: `import axios from 'axios'\nconst { data } = await axios.get('/api/users')`,
      },
      'dayjs': {
        weeklyDownloads: '23M', stars: '46k', lastUpdate: '3天前',
        pros: ['体积极小（2kb）', '链式调用', 'Moment.js API 兼容'],
        cons: ['功能少于 date-fns', '插件需要手动引入'],
        installCmd: 'npm install dayjs',
        quickStart: `import dayjs from 'dayjs'\ndayjs().format('YYYY-MM-DD')`,
      },
      'vitest': {
        weeklyDownloads: '8.5M', stars: '12.9k', lastUpdate: '5天前',
        pros: ['与 Vite 零配置集成', '速度极快', '兼容 Jest API'],
        cons: ['仅适合 Vite 项目'],
        installCmd: 'npm install -D vitest',
        quickStart: `import { test, expect } from 'vitest'\ntest('加法', () => { expect(1+1).toBe(2) })`,
      },
    }
    const name = packageName.toLowerCase().split('@')[0]
    const data = details[name]
    if (!data) return JSON.stringify({ error: `暂无 ${packageName} 的详细信息` })
    return JSON.stringify({ package: packageName, ...data })
  },
  {
    name: 'get_package_details',
    description: '获取 npm 包的详细信息：下载量、优缺点、安装命令和快速开始代码',
    schema: z.object({ packageName: z.string().describe('包名，如 pinia、axios') }),
  }
)

const comparePackagesTool = tool(
  async ({ packages, criteria }) => {
    return JSON.stringify({
      packages,
      criteria,
      recommendation: `根据 ${criteria} 综合评估，推荐使用 ${packages[0]}。
理由：在 ${criteria} 方面表现最优，社区生态成熟，维护活跃。
备选：${packages[1]} 适合需要更高灵活性的场景。`,
      note: '最终选择应结合团队技术栈和项目具体需求决定',
    })
  },
  {
    name: 'compare_packages',
    description: '对比多个 npm 包，给出选型建议',
    schema: z.object({
      packages: z.array(z.string()).describe('要对比的包名列表'),
      criteria: z.string().describe('对比维度，如"生产环境稳定性"、"学习成本"'),
    }),
  }
)

// ── 用 LangGraph ToolNode 构建工具 Agent ─────────────────────

const ALL_TOOLS = [searchPackageTool, getPackageDetailsTool, comparePackagesTool]

const AgentState = Annotation.Root({
  messages: Annotation({ reducer: messagesStateReducer, default: () => [] }),
})

const modelWithTools = model.bindTools(ALL_TOOLS)

async function agentNode(state) {
  const response = await modelWithTools.invoke([
    new SystemMessage('你是前端技术顾问，帮助开发者做技术选型。善用工具查询准确信息，给出有依据的建议。'),
    ...state.messages,
  ])
  return { messages: [response] }
}

// 路由：有工具调用继续执行，没有则结束
function routeAfterAgent(state) {
  const last = state.messages[state.messages.length - 1]
  return last.tool_calls?.length ? 'tools' : '__end__'
}

// ToolNode 自动处理所有工具调用，不需要手写循环
const toolNode = new ToolNode(ALL_TOOLS)

const graph = new StateGraph(AgentState)
  .addNode('agent', agentNode)
  .addNode('tools', toolNode)
  .addEdge(START, 'agent')
  .addConditionalEdges('agent', routeAfterAgent, { tools: 'tools', __end__: END })
  .addEdge('tools', 'agent')
  .compile()

// 测试
const questions = [
  'Vue3 项目做状态管理，pinia 和 vuex 哪个好？给我详细对比',
  '我需要一个轻量的日期处理库，有什么推荐？',
]

for (const q of questions) {
  console.log('\n' + '─'.repeat(60))
  console.log('问题：', q)
  const result = await graph.invoke({ messages: [new HumanMessage(q)] })
  const last = result.messages[result.messages.length - 1]
  console.log('回复：', last.content.slice(0, 400))
}
