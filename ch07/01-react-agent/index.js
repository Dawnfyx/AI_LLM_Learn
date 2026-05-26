// 01-react-agent/index.js
// ReAct Agent：Reason + Act 模式
// 模型自主决定：思考 → 选工具 → 执行 → 观察结果 → 继续思考
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { tool } from '@langchain/core/tools'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import { StateGraph, END, START, Annotation, messagesStateReducer } from '@langchain/langgraph'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { z } from 'zod'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0,
})

// ── 工具集 ────────────────────────────────────────────────────

// 搜索工具（模拟）
const searchTool = tool(
  async ({ query }) => {
    console.log(`  [搜索] "${query}"`)
    const results = {
      'Vue3 最新版本': 'Vue 3.4.21，发布于 2024年3月，主要改进：defineModel 正式稳定，性能提升。',
      'React 18 新特性': 'React 18 引入并发渲染、useTransition、Suspense 改进，2022年3月发布。',
      'Vite 最新版本': 'Vite 5.2，2024年发布，默认使用 Rollup 4，构建速度提升 30%。',
      'TypeScript 5.4': 'TypeScript 5.4 引入 NoInfer 工具类型、闭包中的窄化改进等新特性。',
    }
    const key = Object.keys(results).find(k => query.includes(k.split(' ')[0]))
    return key ? results[key] : `关于"${query}"的搜索结果：暂无直接匹配，请尝试更精确的关键词。`
  },
  {
    name: 'search',
    description: '搜索技术文档和最新资讯。用于查找技术信息、版本更新、最佳实践。',
    schema: z.object({ query: z.string().describe('搜索关键词') }),
  }
)

// 代码执行工具（模拟沙箱）
const runCodeTool = tool(
  async ({ code, language }) => {
    console.log(`  [执行代码] ${language}`)
    // 模拟代码执行结果
    if (code.includes('typeof') || code.includes('console.log')) {
      return `执行结果：\n${code}\n\n输出：(模拟) "执行成功"`
    }
    if (code.includes('Math.')) {
      const result = eval(code.replace('console.log', '').trim())  // 仅演示用
      return `执行结果：${result}`
    }
    return `代码已执行，无输出（或输出需要运行环境）`
  },
  {
    name: 'run_code',
    description: '在沙箱环境执行 JavaScript/TypeScript 代码并返回结果。适合验证代码逻辑。',
    schema: z.object({
      code: z.string().describe('要执行的代码'),
      language: z.enum(['javascript', 'typescript']).default('javascript'),
    }),
  }
)

// 文件读取工具（模拟）
const readFileTool = tool(
  async ({ path }) => {
    console.log(`  [读取文件] ${path}`)
    const mockFiles = {
      'package.json': JSON.stringify({ name: 'my-project', version: '1.0.0', dependencies: { vue: '^3.4.0', vite: '^5.0.0' } }, null, 2),
      'src/main.js': `import { createApp } from 'vue'\nimport App from './App.vue'\ncreateApp(App).mount('#app')`,
      '.env': 'VITE_API_URL=https://api.example.com\nVITE_APP_TITLE=My App',
    }
    return mockFiles[path] ?? `文件 "${path}" 不存在`
  },
  {
    name: 'read_file',
    description: '读取项目文件内容。适合查看配置文件、源代码。',
    schema: z.object({ path: z.string().describe('文件路径，如 package.json') }),
  }
)

const tools = [searchTool, runCodeTool, readFileTool]
const toolNode = new ToolNode(tools)

// ── Agent 图构建 ──────────────────────────────────────────────
const State = Annotation.Root({
  messages: Annotation({ reducer: messagesStateReducer, default: () => [] }),
  // 记录 agent 执行步数，防止无限循环
  steps: Annotation({ reducer: (_, n) => n, default: () => 0 }),
})

const SYSTEM_PROMPT = `你是一位资深的前端开发助手。

能力：
- 使用 search 工具查询最新技术信息
- 使用 run_code 工具验证代码逻辑
- 使用 read_file 工具查看项目文件

工作方式：
1. 分析用户需求，制定解决方案
2. 按需调用工具获取信息或执行操作
3. 综合工具结果给出完整回答
4. 如果一次工具调用不够，继续调用直到任务完成

注意：每次工具调用后，分析结果并决定是否需要继续调用其他工具。`

async function agentNode(state) {
  const response = await model.bindTools(tools).invoke([
    new SystemMessage(SYSTEM_PROMPT),
    ...state.messages,
  ])
  return {
    messages: [response],
    steps: state.steps + 1,
  }
}

// 路由：有工具调用且步数未超限则继续，否则结束
function routeAgent(state) {
  const last = state.messages[state.messages.length - 1]
  if (state.steps >= 10) {
    console.log('  [限制] 达到最大步数 10，强制结束')
    return '__end__'
  }
  return last.tool_calls?.length ? 'tools' : '__end__'
}

const agent = new StateGraph(State)
  .addNode('agent', agentNode)
  .addNode('tools', toolNode)
  .addEdge(START, 'agent')
  .addConditionalEdges('agent', routeAgent, { tools: 'tools', __end__: END })
  .addEdge('tools', 'agent')
  .compile()

// ── 测试 ─────────────────────────────────────────────────────
async function run(task) {
  console.log('\n' + '═'.repeat(60))
  console.log('任务：', task)
  console.log('─'.repeat(60))

  const result = await agent.invoke({
    messages: [new HumanMessage(task)],
    steps: 0,
  })

  const last = result.messages[result.messages.length - 1]
  console.log('\n最终回答：\n', last.content)
  console.log(`\n共执行 ${result.steps} 步，调用了 ${result.messages.filter(m => m._getType() === 'tool').length} 次工具`)
}

// 任务1：需要搜索 + 读文件
await run('查一下 Vue3 最新版本是什么，然后看看我的项目 package.json 里用的是哪个版本，告诉我需不需要升级')

// 任务2：需要搜索多次
await run('对比一下 Vue3 和 React 18 各自最主要的新特性')

// 任务3：需要执行代码
await run('帮我计算一下 Math.PI 的值精确到小数点后10位，用代码执行验证')
