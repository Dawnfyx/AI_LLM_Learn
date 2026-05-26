// 03-parallel-tools/index.js
// 并行工具调用：模型一次调用多个工具，ToolNode 并发执行，减少等待时间
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { tool } from '@langchain/core/tools'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages'
import { z } from 'zod'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0,
})

// ── 模拟有延迟的工具（验证并发效果）────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

const getStockPrice = tool(
  async ({ symbol }) => {
    await sleep(800) // 模拟网络延迟
    const prices = { AAPL: 189.5, MSFT: 415.2, GOOGL: 175.8, BIDU: 98.3 }
    const price = prices[symbol]
    if (!price) return JSON.stringify({ error: `未找到 ${symbol}` })
    return JSON.stringify({ symbol, price, currency: 'USD', change: '+1.2%' })
  },
  {
    name: 'get_stock_price',
    description: '查询股票的实时价格',
    schema: z.object({ symbol: z.string().describe('股票代码，如 AAPL、MSFT') }),
  }
)

const getExchangeRate = tool(
  async ({ from, to }) => {
    await sleep(600)
    const rates = { 'USD-CNY': 7.24, 'USD-JPY': 149.5, 'EUR-CNY': 7.85 }
    const key = `${from}-${to}`
    const rate = rates[key]
    if (!rate) return JSON.stringify({ error: `暂不支持 ${from} 到 ${to}` })
    return JSON.stringify({ from, to, rate, updateTime: new Date().toLocaleTimeString() })
  },
  {
    name: 'get_exchange_rate',
    description: '查询两种货币之间的汇率',
    schema: z.object({
      from: z.string().describe('源货币，如 USD'),
      to: z.string().describe('目标货币，如 CNY'),
    }),
  }
)

const getMarketNews = tool(
  async ({ topic }) => {
    await sleep(700)
    const news = {
      'tech': ['苹果发布 M4 芯片新品', '微软 AI 助手日活突破 1 亿'],
      'finance': ['美联储维持利率不变', '纳斯达克指数创新高'],
    }
    const articles = news[topic] || ['暂无相关新闻']
    return JSON.stringify({ topic, headlines: articles, time: '今日 10:30' })
  },
  {
    name: 'get_market_news',
    description: '获取最新的市场新闻',
    schema: z.object({
      topic: z.enum(['tech', 'finance']).describe('新闻主题'),
    }),
  }
)

const tools = [getStockPrice, getExchangeRate, getMarketNews]
const toolNode = new ToolNode(tools)

// ── 验证并行 vs 串行的时间差 ─────────────────────────────────
async function runWithTiming(userMessage) {
  console.log('\n用户：', userMessage)

  const modelWithTools = model.bindTools(tools)

  const messages = [
    new SystemMessage('你是金融助手，需要查询多个数据时，同时调用多个工具，不要逐个调用。'),
    new HumanMessage(userMessage),
  ]

  const start = Date.now()
  const firstResponse = await modelWithTools.invoke(messages)

  if (!firstResponse.tool_calls?.length) {
    console.log('直接回答：', firstResponse.content)
    return
  }

  console.log(`模型调用了 ${firstResponse.tool_calls.length} 个工具：`,
    firstResponse.tool_calls.map(c => c.name).join(', '))

  // ToolNode 内部并发执行所有工具调用（Promise.all）
  // 如果 3 个工具各耗时 800/600/700ms，串行需要 2100ms，并发只需 ~800ms
  const toolResult = await toolNode.invoke({ messages: [...messages, firstResponse] })
  const toolTime = Date.now() - start

  console.log(`工具执行耗时：${toolTime}ms（${firstResponse.tool_calls.length} 个工具并发）`)

  // 最终生成回复
  const finalResponse = await modelWithTools.invoke([
    ...messages,
    firstResponse,
    ...toolResult.messages,
  ])

  console.log('最终回复：', finalResponse.content)
  console.log(`总耗时：${Date.now() - start}ms`)
}

// 这个问题会触发 3 个工具同时调用
await runWithTiming('苹果和微软的股票价格是多少？USD 兑 CNY 的汇率是多少？同时给我看看今天的科技新闻头条')

// 这个问题只触发 1 个工具
await runWithTiming('美元兑日元现在是多少？')
