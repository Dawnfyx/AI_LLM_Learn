// 05-vue-tool-dashboard/server.js
// 可视化工具调用的 Express 服务端
// 通过 SSE 实时推送：工具调用开始、工具执行结果、最终回复
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { ChatOpenAI } from '@langchain/openai'
import { tool } from '@langchain/core/tools'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import { StateGraph, END, START, Annotation, messagesStateReducer } from '@langchain/langgraph'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { z } from 'zod'

const app = express()
app.use(cors())
app.use(express.json())

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0,
  streaming: true,
})

// ── 工具定义 ──────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

const searchProductTool = tool(
  async ({ keyword, maxPrice }) => {
    await sleep(400)
    const products = [
      { id: 1, name: 'iPhone 15 Pro 手机壳', price: 89, rating: 4.8, sales: 12000 },
      { id: 2, name: 'AirPods Pro 收纳包', price: 45, rating: 4.6, sales: 8500 },
      { id: 3, name: '无线充电器 15W', price: 128, rating: 4.7, sales: 6200 },
      { id: 4, name: 'MagSafe 磁吸支架', price: 65, rating: 4.5, sales: 9800 },
    ]

    let results = products.filter(p => p.name.includes(keyword))
    if (maxPrice) results = results.filter(p => p.price <= maxPrice)

    return JSON.stringify({
      keyword,
      found: results.length,
      products: results.map(p => ({
        ...p,
        priceDisplay: `¥${p.price}`,
        ratingDisplay: `${p.rating}分（${p.sales.toLocaleString()}件已售）`,
      })),
    })
  },
  {
    name: 'search_product',
    description: '在商品库中搜索商品，支持关键词和价格过滤',
    schema: z.object({
      keyword: z.string().describe('搜索关键词'),
      maxPrice: z.number().optional().describe('最高价格限制（元）'),
    }),
  }
)

const getRecommendTool = tool(
  async ({ category, budget }) => {
    await sleep(300)
    const recs = {
      '手机配件': [
        { name: '钢化膜套装', price: 29, reason: '销量第一，性价比高' },
        { name: '硅胶保护壳', price: 39, reason: '手感好，防摔性能优秀' },
      ],
      '数码': [
        { name: '便携充电宝', price: 89, reason: '容量大，支持快充' },
        { name: '数据线 3 合 1', price: 35, reason: '兼容性强，耐用' },
      ],
    }

    const items = recs[category] || recs['数码']
    const filtered = budget ? items.filter(i => i.price <= budget) : items

    return JSON.stringify({ category, budget, recommendations: filtered })
  },
  {
    name: 'get_recommendation',
    description: '根据品类和预算获取商品推荐',
    schema: z.object({
      category: z.string().describe('商品品类，如：手机配件、数码'),
      budget: z.number().optional().describe('预算上限（元）'),
    }),
  }
)

const calcShippingTool = tool(
  async ({ city, totalAmount }) => {
    await sleep(200)
    const freeShippingCities = ['北京', '上海', '广州', '深圳', '杭州']
    const isFree = freeShippingCities.includes(city) || totalAmount >= 99

    return JSON.stringify({
      city,
      totalAmount,
      shippingFee: isFree ? 0 : 8,
      freeShippingTip: isFree
        ? '包邮'
        : `还差 ¥${(99 - totalAmount).toFixed(2)} 可免运费`,
      estimatedDays: freeShippingCities.includes(city) ? '1-2天' : '3-5天',
    })
  },
  {
    name: 'calc_shipping',
    description: '计算运费和预计配送时间',
    schema: z.object({
      city: z.string().describe('收货城市'),
      totalAmount: z.number().describe('订单总金额（元）'),
    }),
  }
)

const tools = [searchProductTool, getRecommendTool, calcShippingTool]
const toolNode = new ToolNode(tools)

// ── LangGraph 图 ──────────────────────────────────────────────
const State = Annotation.Root({
  messages: Annotation({ reducer: messagesStateReducer, default: () => [] }),
})

function buildGraph(sendEvent) {
  async function agentNode(state) {
    const response = await model.bindTools(tools).invoke([
      new SystemMessage('你是极速购商城的购物助手，帮用户找商品、推荐、算运费。'),
      ...state.messages,
    ])
    return { messages: [response] }
  }

  function route(state) {
    const last = state.messages[state.messages.length - 1]
    return last.tool_calls?.length ? 'tools' : '__end__'
  }

  return new StateGraph(State)
    .addNode('agent', agentNode)
    .addNode('tools', toolNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', route, { tools: 'tools', __end__: END })
    .addEdge('tools', 'agent')
    .compile()
}

// ── SSE 接口：实时推送工具调用状态 ───────────────────────────
app.post('/api/chat/stream', async (req, res) => {
  const { message } = req.body

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const send = (event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  try {
    const graph = buildGraph(send)
    send('start', { message })

    let fullReply = ''

    for await (const event of graph.streamEvents(
      { messages: [new HumanMessage(message)] },
      { version: 'v2' }
    )) {
      // 工具调用开始
      if (event.event === 'on_tool_start') {
        send('tool_start', {
          toolName: event.name,
          args: event.data?.input,
        })
      }

      // 工具调用结束
      if (event.event === 'on_tool_end') {
        send('tool_end', {
          toolName: event.name,
          result: event.data?.output,
        })
      }

      // 模型流式 token
      if (
        event.event === 'on_chat_model_stream' &&
        event.data?.chunk?.content
      ) {
        fullReply += event.data.chunk.content
        send('token', { token: event.data.chunk.content })
      }
    }

    send('done', { fullReply })
  } catch (err) {
    send('error', { message: err.message })
  } finally {
    res.end()
  }
})

app.listen(3000, () => console.log('服务已启动：http://localhost:3000'))
