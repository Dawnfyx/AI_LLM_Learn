// 02-multi-tools/index.js
// 多工具场景：LangGraph ToolNode 自动执行工具，无需手动 for 循环
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

// ── 定义多个工具 ──────────────────────────────────────────────

// 工具1：查询用户信息
const getUserInfoTool = tool(
  async ({ userId }) => {
    const users = {
      'user_001': { name: '张三', email: 'zhangsan@example.com', vipLevel: '黄金会员', points: 2580 },
      'user_002': { name: '李四', email: 'lisi@example.com', vipLevel: '普通会员', points: 120 },
    }
    const user = users[userId]
    if (!user) return JSON.stringify({ error: `用户 ${userId} 不存在` })
    return JSON.stringify(user)
  },
  {
    name: 'get_user_info',
    description: '查询用户的基本信息，包括姓名、邮箱、会员等级、积分',
    schema: z.object({
      userId: z.string().describe('用户ID，格式如 user_001'),
    }),
  }
)

// 工具2：查询订单状态
const getOrderTool = tool(
  async ({ orderId }) => {
    const orders = {
      'ORD-001': { product: 'iPhone 15 手机壳', amount: 89, status: '已发货', tracking: 'SF1234567890', estimatedDelivery: '明天下午' },
      'ORD-002': { product: '无线蓝牙耳机', amount: 299, status: '已签收', tracking: 'YT9876543210', signedAt: '昨天 14:30' },
      'ORD-003': { product: 'USB-C 充电线', amount: 45, status: '待发货', tracking: null, estimatedShip: '今天 18:00 前' },
    }
    const order = orders[orderId]
    if (!order) return JSON.stringify({ error: `订单 ${orderId} 不存在` })
    return JSON.stringify({ orderId, ...order })
  },
  {
    name: 'get_order',
    description: '查询订单的状态、物流信息、预计送达时间',
    schema: z.object({
      orderId: z.string().describe('订单号，格式如 ORD-001'),
    }),
  }
)

// 工具3：计算积分价值
const calcPointsTool = tool(
  async ({ points, action }) => {
    const rules = {
      'exchange_cash': { rate: 0.01, desc: '积分兑换现金' },  // 100积分 = 1元
      'exchange_coupon': { rate: 0.02, desc: '积分兑换优惠券' }, // 100积分 = 2元券
      'get_level': { thresholds: { 500: '白银', 2000: '黄金', 5000: '铂金' } },
    }

    if (action === 'get_level') {
      const { thresholds } = rules.get_level
      let level = '普通'
      for (const [min, name] of Object.entries(thresholds)) {
        if (points >= Number(min)) level = name
      }
      return JSON.stringify({ points, currentLevel: level })
    }

    const rule = rules[action]
    if (!rule) return JSON.stringify({ error: '不支持的操作' })

    return JSON.stringify({
      points,
      action: rule.desc,
      value: `¥${(points * rule.rate).toFixed(2)}`,
    })
  },
  {
    name: 'calc_points',
    description: '计算用户积分的价值，或查询积分对应的会员等级',
    schema: z.object({
      points: z.number().describe('积分数量'),
      action: z.enum(['exchange_cash', 'exchange_coupon', 'get_level']).describe(
        'exchange_cash: 积分兑现金；exchange_coupon: 兑优惠券；get_level: 查等级'
      ),
    }),
  }
)

const tools = [getUserInfoTool, getOrderTool, calcPointsTool]

// ── 用 LangGraph 构建自动工具调用图 ──────────────────────────
const State = Annotation.Root({
  messages: Annotation({ reducer: messagesStateReducer, default: () => [] }),
})

// ToolNode 自动：找出 messages 中最后一条 AIMessage 的 tool_calls，批量执行所有工具
const toolNode = new ToolNode(tools)

async function agentNode(state) {
  const response = await model.bindTools(tools).invoke([
    new SystemMessage('你是极速购电商平台的智能客服。根据用户问题，选择合适的工具查询真实数据后回答。可以同时调用多个工具。'),
    ...state.messages,
  ])
  return { messages: [response] }
}

// 路由：有 tool_calls 就去执行工具，没有就结束
function routeAfterAgent(state) {
  const last = state.messages[state.messages.length - 1]
  return last.tool_calls?.length ? 'tools' : '__end__'
}

const graph = new StateGraph(State)
  .addNode('agent', agentNode)
  .addNode('tools', toolNode)
  .addEdge(START, 'agent')
  .addConditionalEdges('agent', routeAfterAgent, { tools: 'tools', __end__: END })
  .addEdge('tools', 'agent')   // 工具执行完，回到 agent 生成最终回复
  .compile()

// 测试
const questions = [
  '查一下用户 user_001 的信息，以及他的 ORD-001 订单状态',
  '用户 user_002 有 120 积分，能兑换多少现金？他当前是什么会员等级？',
  '我的 ORD-003 订单什么时候发货？',
]

for (const q of questions) {
  console.log('\n' + '═'.repeat(55))
  console.log('用户：', q)

  const result = await graph.invoke({
    messages: [new HumanMessage(q)],
  })

  const last = result.messages[result.messages.length - 1]
  console.log('回复：', last.content)
}
