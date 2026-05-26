// 04-tool-with-state/index.js
// 有副作用的工具：写数据库、发邮件、修改状态
// 重点：工具的权限控制、幂等性、错误处理
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

// ── 模拟数据库 ────────────────────────────────────────────────
const db = {
  todos: [
    { id: 1, title: '学习 Vue3', done: false, priority: 'high' },
    { id: 2, title: '写项目文档', done: false, priority: 'medium' },
    { id: 3, title: '代码 review', done: true, priority: 'low' },
  ],
  nextId: 4,
}

// ── 查询工具（只读，无副作用）────────────────────────────────
const listTodosTool = tool(
  async ({ filter = 'all' }) => {
    let items = db.todos
    if (filter === 'done') items = items.filter(t => t.done)
    if (filter === 'pending') items = items.filter(t => !t.done)

    return JSON.stringify({
      total: db.todos.length,
      shown: items.length,
      items: items.map(t => ({
        id: t.id,
        title: t.title,
        status: t.done ? '已完成' : '待完成',
        priority: t.priority,
      })),
    })
  },
  {
    name: 'list_todos',
    description: '查看待办事项列表，可按状态过滤',
    schema: z.object({
      filter: z.enum(['all', 'done', 'pending']).default('all').describe('过滤条件'),
    }),
  }
)

// ── 写入工具（有副作用，修改数据库）─────────────────────────
const addTodoTool = tool(
  async ({ title, priority = 'medium' }) => {
    // 幂等性检查：避免重复添加相同标题的待办
    const exists = db.todos.find(t => t.title === title)
    if (exists) {
      return JSON.stringify({ success: false, message: `"${title}" 已存在，ID: ${exists.id}` })
    }

    const newTodo = { id: db.nextId++, title, done: false, priority }
    db.todos.push(newTodo)

    console.log(`[DB] 新增待办: ${JSON.stringify(newTodo)}`)

    return JSON.stringify({
      success: true,
      message: `已添加：${title}`,
      todo: newTodo,
    })
  },
  {
    name: 'add_todo',
    description: '添加一条新的待办事项',
    schema: z.object({
      title: z.string().min(2).describe('待办事项内容，至少2个字'),
      priority: z.enum(['high', 'medium', 'low']).default('medium').describe('优先级'),
    }),
  }
)

const completeTodoTool = tool(
  async ({ id }) => {
    const todo = db.todos.find(t => t.id === id)
    if (!todo) return JSON.stringify({ success: false, message: `ID ${id} 不存在` })
    if (todo.done) return JSON.stringify({ success: false, message: `"${todo.title}" 已经是完成状态` })

    todo.done = true
    console.log(`[DB] 标记完成: ID ${id} - ${todo.title}`)

    return JSON.stringify({ success: true, message: `已完成：${todo.title}` })
  },
  {
    name: 'complete_todo',
    description: '把指定 ID 的待办事项标记为已完成',
    schema: z.object({
      id: z.number().describe('待办事项的 ID'),
    }),
  }
)

const deleteTodoTool = tool(
  async ({ id, confirm }) => {
    // 删除是破坏性操作，要求确认
    if (!confirm) {
      return JSON.stringify({
        success: false,
        message: '删除操作需要确认，请将 confirm 设为 true',
      })
    }

    const index = db.todos.findIndex(t => t.id === id)
    if (index === -1) return JSON.stringify({ success: false, message: `ID ${id} 不存在` })

    const [deleted] = db.todos.splice(index, 1)
    console.log(`[DB] 删除待办: ${JSON.stringify(deleted)}`)

    return JSON.stringify({ success: true, message: `已删除：${deleted.title}` })
  },
  {
    name: 'delete_todo',
    description: '删除待办事项，这是不可逆操作，需要明确确认',
    schema: z.object({
      id: z.number().describe('要删除的待办 ID'),
      confirm: z.boolean().describe('必须为 true 才会真正执行删除'),
    }),
  }
)

const tools = [listTodosTool, addTodoTool, completeTodoTool, deleteTodoTool]
const toolNode = new ToolNode(tools)

const State = Annotation.Root({
  messages: Annotation({ reducer: messagesStateReducer, default: () => [] }),
})

async function agentNode(state) {
  const response = await model.bindTools(tools).invoke([
    new SystemMessage(`你是待办事项助手。
规则：
- 修改操作（添加/完成/删除）前，先查询确认数据存在
- 删除前必须告知用户这是不可逆操作
- 完成任务后汇报执行了哪些操作`),
    ...state.messages,
  ])
  return { messages: [response] }
}

function route(state) {
  const last = state.messages[state.messages.length - 1]
  return last.tool_calls?.length ? 'tools' : '__end__'
}

const graph = new StateGraph(State)
  .addNode('agent', agentNode)
  .addNode('tools', toolNode)
  .addEdge(START, 'agent')
  .addConditionalEdges('agent', route, { tools: 'tools', __end__: END })
  .addEdge('tools', 'agent')
  .compile()

async function run(message) {
  console.log('\n' + '═'.repeat(55))
  console.log('用户：', message)
  const result = await graph.invoke({ messages: [new HumanMessage(message)] })
  const last = result.messages[result.messages.length - 1]
  console.log('回复：', last.content)
  console.log('当前数据库：', db.todos.map(t => `[${t.done ? '✓' : ' '}] ${t.title}`))
}

await run('帮我看看现在有哪些待办')
await run('添加两个新任务：阅读技术文章（高优先级）和整理桌面')
await run('把 ID 为 1 的任务标记为完成')
await run('删除已完成的任务 ID 3')
