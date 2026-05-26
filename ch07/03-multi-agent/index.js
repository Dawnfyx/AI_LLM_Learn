// 03-multi-agent/index.js
// 多 Agent 协作：Supervisor 模式
// 一个 Supervisor Agent 分配任务给专职 Agent，各司其职
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { tool } from '@langchain/core/tools'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import { StateGraph, END, START, Annotation, messagesStateReducer } from '@langchain/langgraph'
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'
import { z } from 'zod'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0,
})

// ── 各专职 Agent 的工具 ───────────────────────────────────────

// 代码 Agent 的工具
const generateCodeTool = tool(
  async ({ requirement, framework }) => {
    console.log(`  [代码Agent] 生成 ${framework} 组件：${requirement}`)
    const templates = {
      vue3: `<template>
  <div class="component">
    <slot />
  </div>
</template>
<script setup>
import { ref, computed } from 'vue'
// ${requirement} 实现
const data = ref(null)
</script>`,
      react: `import { useState, useEffect } from 'react'
// ${requirement} 实现
export default function Component() {
  const [data, setData] = useState(null)
  return <div className="component">{data}</div>
}`,
    }
    return templates[framework] || `// ${requirement} 代码（${framework}）`
  },
  {
    name: 'generate_code',
    description: '生成前端组件代码',
    schema: z.object({
      requirement: z.string(),
      framework: z.enum(['vue3', 'react']).default('vue3'),
    }),
  }
)

// 测试 Agent 的工具
const generateTestTool = tool(
  async ({ componentName, framework }) => {
    console.log(`  [测试Agent] 生成 ${componentName} 测试`)
    return `// ${componentName} 单元测试
import { mount } from '@vue/test-utils'
import ${componentName} from './${componentName}.vue'

describe('${componentName}', () => {
  it('renders correctly', () => {
    const wrapper = mount(${componentName})
    expect(wrapper.exists()).toBe(true)
  })

  it('handles props', () => {
    const wrapper = mount(${componentName}, { props: { title: 'Test' } })
    expect(wrapper.props('title')).toBe('Test')
  })
})`
  },
  {
    name: 'generate_test',
    description: '生成组件单元测试代码',
    schema: z.object({
      componentName: z.string(),
      framework: z.enum(['vue3', 'react']).default('vue3'),
    }),
  }
)

// 文档 Agent 的工具
const generateDocsTool = tool(
  async ({ componentName, props }) => {
    console.log(`  [文档Agent] 生成 ${componentName} 文档`)
    return `# ${componentName}

## Props

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
${props.map(p => `| ${p.name} | ${p.type} | ${p.default} | ${p.desc} |`).join('\n')}

## 使用示例

\`\`\`vue
<${componentName} title="标题" @change="handleChange" />
\`\`\``
  },
  {
    name: 'generate_docs',
    description: '生成组件文档',
    schema: z.object({
      componentName: z.string(),
      props: z.array(z.object({
        name: z.string(), type: z.string(),
        default: z.string(), desc: z.string(),
      })).default([]),
    }),
  }
)

// ── 多 Agent 状态 ─────────────────────────────────────────────
const State = Annotation.Root({
  messages:      Annotation({ reducer: messagesStateReducer, default: () => [] }),
  task:          Annotation({ reducer: (_, n) => n, default: () => '' }),
  nextAgent:     Annotation({ reducer: (_, n) => n, default: () => '' }),
  results:       Annotation({ reducer: (a, b) => ({ ...a, ...b }), default: () => ({}) }),
  completed:     Annotation({ reducer: (_, n) => n, default: () => false }),
})

// ── Supervisor：分配任务 ──────────────────────────────────────
const RouteSchema = z.object({
  nextAgent: z.enum(['code_agent', 'test_agent', 'doc_agent', 'FINISH']),
  reason: z.string(),
  instruction: z.string().describe('给下一个 Agent 的具体指令'),
})

async function supervisorNode(state) {
  const routeModel = model.withStructuredOutput(RouteSchema)

  const completedWork = Object.keys(state.results).join(', ') || '无'

  const response = await routeModel.invoke([
    new SystemMessage(`你是任务调度器，负责将前端开发任务分配给专职 Agent。

可用 Agent：
- code_agent：负责生成组件代码
- test_agent：负责生成单元测试（需要先有代码）
- doc_agent：负责生成组件文档（需要先有代码）
- FINISH：所有任务已完成

任务：${state.task}
已完成：${completedWork}

判断下一步应该由哪个 Agent 处理，给出清晰的指令。`),
    new HumanMessage('请决定下一步'),
  ])

  console.log(`  [Supervisor] → ${response.nextAgent}：${response.reason}`)

  return {
    nextAgent: response.nextAgent,
    messages: [new AIMessage(`调度到 ${response.nextAgent}：${response.instruction}`)],
    completed: response.nextAgent === 'FINISH',
  }
}

// ── 代码 Agent ────────────────────────────────────────────────
const codeToolNode = new ToolNode([generateCodeTool])

async function codeAgentNode(state) {
  const response = await model.bindTools([generateCodeTool]).invoke([
    new SystemMessage('你是 Vue3 组件开发专家，负责生成高质量的组件代码。'),
    new HumanMessage(state.task),
  ])
  return { messages: [response] }
}

async function codeAgentToolNode(state) {
  const result = await codeToolNode.invoke(state)
  // 把代码结果存到 results
  const toolMsg = result.messages[result.messages.length - 1]
  return {
    messages: result.messages,
    results: { code: toolMsg.content },
  }
}

// ── 测试 Agent ────────────────────────────────────────────────
const testToolNode = new ToolNode([generateTestTool])

async function testAgentNode(state) {
  const codeResult = state.results.code || ''
  const response = await model.bindTools([generateTestTool]).invoke([
    new SystemMessage('你是前端测试工程师，根据组件代码生成完整的单元测试。'),
    new HumanMessage(`组件代码：\n${codeResult}\n\n任务：${state.task}`),
  ])
  return { messages: [response] }
}

async function testAgentToolNode(state) {
  const result = await testToolNode.invoke(state)
  const toolMsg = result.messages[result.messages.length - 1]
  return {
    messages: result.messages,
    results: { test: toolMsg.content },
  }
}

// ── 文档 Agent ────────────────────────────────────────────────
const docToolNode = new ToolNode([generateDocsTool])

async function docAgentNode(state) {
  const response = await model.bindTools([generateDocsTool]).invoke([
    new SystemMessage('你是技术文档工程师，根据组件代码生成清晰的使用文档。'),
    new HumanMessage(`组件代码：\n${state.results.code || ''}\n\n任务：${state.task}`),
  ])
  return { messages: [response] }
}

async function docAgentToolNode(state) {
  const result = await docToolNode.invoke(state)
  const toolMsg = result.messages[result.messages.length - 1]
  return {
    messages: result.messages,
    results: { docs: toolMsg.content },
  }
}

// ── 路由函数 ──────────────────────────────────────────────────
function routeFromSupervisor(state) {
  if (state.completed) return 'end'
  const routes = {
    code_agent: 'code_agent',
    test_agent: 'test_agent',
    doc_agent:  'doc_agent',
    FINISH:     'end',
  }
  return routes[state.nextAgent] ?? 'end'
}

function routeCodeAgent(state) {
  const last = state.messages[state.messages.length - 1]
  return last.tool_calls?.length ? 'code_tools' : 'supervisor'
}

function routeTestAgent(state) {
  const last = state.messages[state.messages.length - 1]
  return last.tool_calls?.length ? 'test_tools' : 'supervisor'
}

function routeDocAgent(state) {
  const last = state.messages[state.messages.length - 1]
  return last.tool_calls?.length ? 'doc_tools' : 'supervisor'
}

// ── 构建多 Agent 图 ───────────────────────────────────────────
const multiAgentGraph = new StateGraph(State)
  .addNode('supervisor',  supervisorNode)
  .addNode('code_agent',  codeAgentNode)
  .addNode('code_tools',  codeAgentToolNode)
  .addNode('test_agent',  testAgentNode)
  .addNode('test_tools',  testAgentToolNode)
  .addNode('doc_agent',   docAgentNode)
  .addNode('doc_tools',   docAgentToolNode)
  .addEdge(START, 'supervisor')
  .addConditionalEdges('supervisor', routeFromSupervisor, {
    code_agent: 'code_agent', test_agent: 'test_agent',
    doc_agent: 'doc_agent', end: END,
  })
  .addConditionalEdges('code_agent', routeCodeAgent, { code_tools: 'code_tools', supervisor: 'supervisor' })
  .addEdge('code_tools', 'supervisor')
  .addConditionalEdges('test_agent', routeTestAgent, { test_tools: 'test_tools', supervisor: 'supervisor' })
  .addEdge('test_tools', 'supervisor')
  .addConditionalEdges('doc_agent', routeDocAgent, { doc_tools: 'doc_tools', supervisor: 'supervisor' })
  .addEdge('doc_tools', 'supervisor')
  .compile()

// 测试
console.log('=== 多 Agent 协作（Supervisor 模式）===\n')

const result = await multiAgentGraph.invoke({
  messages: [],
  task: '开发一个 Vue3 的用户信息卡片组件（UserCard），需要代码、单元测试和文档',
  nextAgent: '',
  results: {},
  completed: false,
})

console.log('\n\n=== 最终产物 ===')
console.log('\n[代码]:\n', result.results.code?.slice(0, 200))
console.log('\n[测试]:\n', result.results.test?.slice(0, 200))
console.log('\n[文档]:\n', result.results.docs?.slice(0, 200))
