// 04-cost-monitor/index.js
// 成本监控：记录每次调用的 token 消耗和费用，生成报表
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { BaseCallbackHandler } from '@langchain/core/callbacks/base'
import fs from 'fs/promises'

// ── 模型定价配置 ──────────────────────────────────────────────
const PRICING = {
  'deepseek-chat':          { input: 0.27,  output: 1.10,  currency: 'USD' },
  'deepseek-reasoner':      { input: 0.55,  output: 2.19,  currency: 'USD' },
  'gpt-4o':                 { input: 2.50,  output: 10.0,  currency: 'USD' },
  'gpt-4o-mini':            { input: 0.15,  output: 0.60,  currency: 'USD' },
  'claude-3-5-sonnet':      { input: 3.00,  output: 15.0,  currency: 'USD' },
}

function calcCost(model, inputTokens, outputTokens) {
  const price = PRICING[model] || PRICING['deepseek-chat']
  return {
    inputCost:  (inputTokens  / 1_000_000) * price.input,
    outputCost: (outputTokens / 1_000_000) * price.output,
    totalCost:  (inputTokens  / 1_000_000) * price.input +
                (outputTokens / 1_000_000) * price.output,
  }
}

// ── 成本追踪回调 ──────────────────────────────────────────────
class CostTracker extends BaseCallbackHandler {
  name = 'CostTracker'

  constructor(modelName, budgetAlert) {
    super()
    this.modelName = modelName
    this.budgetAlert = budgetAlert    // 单次超过此金额发出警告（USD）
    this.records = []                  // 所有调用记录
    this.session = {
      startTime: Date.now(),
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCost: 0,
      callCount: 0,
    }
  }

  // LangChain 在每次 LLM 调用结束时触发
  handleLLMEnd(output, runId) {
    const usage = output.llmOutput?.tokenUsage
    if (!usage) return

    const { inputTokens, outputTokens, totalTokens } = usage
    const cost = calcCost(this.modelName, inputTokens, outputTokens)

    const record = {
      time: new Date().toISOString(),
      inputTokens,
      outputTokens,
      totalTokens,
      ...cost,
    }

    this.records.push(record)
    this.session.totalInputTokens  += inputTokens
    this.session.totalOutputTokens += outputTokens
    this.session.totalCost         += cost.totalCost
    this.session.callCount++

    // 单次费用告警
    if (this.budgetAlert && cost.totalCost > this.budgetAlert) {
      console.warn(`  ⚠️  单次调用费用 $${cost.totalCost.toFixed(6)} 超过阈值 $${this.budgetAlert}`)
    }

    console.log(`  [费用] 输入:${inputTokens} 输出:${outputTokens} 费用:$${cost.totalCost.toFixed(6)} (¥${(cost.totalCost * 7.2).toFixed(4)})`)
  }

  // 累计费用告警
  checkBudget(dailyBudgetUSD) {
    if (this.session.totalCost > dailyBudgetUSD) {
      console.warn(`  🚨 累计费用 $${this.session.totalCost.toFixed(4)} 超过预算 $${dailyBudgetUSD}`)
      return false
    }
    return true
  }

  // 生成报表
  report() {
    const duration = (Date.now() - this.session.startTime) / 1000
    const avgCost = this.session.callCount
      ? this.session.totalCost / this.session.callCount
      : 0

    return {
      summary: {
        duration: `${duration.toFixed(1)}s`,
        callCount: this.session.callCount,
        totalInputTokens:  this.session.totalInputTokens,
        totalOutputTokens: this.session.totalOutputTokens,
        totalTokens: this.session.totalInputTokens + this.session.totalOutputTokens,
        totalCostUSD: `$${this.session.totalCost.toFixed(6)}`,
        totalCostCNY: `¥${(this.session.totalCost * 7.2).toFixed(4)}`,
        avgCostPerCall: `$${avgCost.toFixed(6)}`,
        // 按当前速率估算月成本（假设 8 小时/天）
        estimatedMonthlyUSD: `$${(this.session.totalCost / duration * 3600 * 8 * 30).toFixed(2)}`,
      },
      records: this.records,
    }
  }

  async saveReport(filepath = './cost-report.json') {
    await fs.writeFile(filepath, JSON.stringify(this.report(), null, 2))
    console.log(`  [报告] 已保存到 ${filepath}`)
  }
}

// ── 全局费用监控（Singleton）─────────────────────────────────
class GlobalCostMonitor {
  constructor() {
    this.dailyStats = new Map()   // date → { calls, tokens, cost }
    this.modelStats = new Map()   // modelName → { calls, tokens, cost }
    this.featureStats = new Map() // feature → { calls, tokens, cost }
  }

  record({ model, feature, inputTokens, outputTokens }) {
    const today = new Date().toISOString().split('T')[0]
    const cost = calcCost(model, inputTokens, outputTokens).totalCost

    // 按日期统计
    this.updateMap(this.dailyStats, today, { inputTokens, outputTokens, cost })
    // 按模型统计
    this.updateMap(this.modelStats, model, { inputTokens, outputTokens, cost })
    // 按功能统计（RAG / Chat / Agent 等）
    if (feature) this.updateMap(this.featureStats, feature, { inputTokens, outputTokens, cost })
  }

  updateMap(map, key, { inputTokens, outputTokens, cost }) {
    const current = map.get(key) || { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 }
    map.set(key, {
      calls:        current.calls + 1,
      inputTokens:  current.inputTokens + inputTokens,
      outputTokens: current.outputTokens + outputTokens,
      cost:         current.cost + cost,
    })
  }

  getReport() {
    const format = (map) => Object.fromEntries(
      [...map.entries()].map(([k, v]) => [k, {
        ...v,
        costUSD: `$${v.cost.toFixed(4)}`,
        costCNY: `¥${(v.cost * 7.2).toFixed(2)}`,
      }])
    )

    return {
      byDate:    format(this.dailyStats),
      byModel:   format(this.modelStats),
      byFeature: format(this.featureStats),
    }
  }
}

// ── 测试 ─────────────────────────────────────────────────────
async function testCostMonitor() {
  console.log('=== 成本监控测试 ===\n')

  const tracker = new CostTracker('deepseek-chat', 0.001)  // 单次超过 $0.001 告警

  const model = new ChatOpenAI({
    model: 'deepseek-chat',
    apiKey: process.env.DEEPSEEK_API_KEY,
    configuration: { baseURL: 'https://api.deepseek.com/v1' },
    temperature: 0,
    callbacks: [tracker],   // 注入追踪器
  })

  // 模拟几次调用
  await model.invoke([new HumanMessage('用一句话介绍 Vue3')])
  await model.invoke([
    new SystemMessage('你是前端专家'),
    new HumanMessage('解释 Composition API 的优势，300字'),
  ])
  await model.invoke([new HumanMessage('什么是 Tree Shaking？')])

  // 输出报表
  console.log('\n=== 费用报表 ===')
  const report = tracker.report()
  console.log('汇总：', JSON.stringify(report.summary, null, 2))

  // 全局监控演示
  const monitor = new GlobalCostMonitor()
  monitor.record({ model: 'deepseek-chat', feature: 'chat',  inputTokens: 100, outputTokens: 200 })
  monitor.record({ model: 'deepseek-chat', feature: 'rag',   inputTokens: 500, outputTokens: 300 })
  monitor.record({ model: 'gpt-4o-mini',  feature: 'agent',  inputTokens: 200, outputTokens: 150 })

  console.log('\n全局监控报表：')
  console.log(JSON.stringify(monitor.getReport(), null, 2))
}

// ── 预算控制中间件（Express）──────────────────────────────────
export class BudgetGuard {
  constructor({ dailyBudgetUSD = 10, perRequestMax = 0.05 }) {
    this.dailyBudget = dailyBudgetUSD
    this.perRequestMax = perRequestMax
    this.todaySpend = 0
    this.lastReset = new Date().toDateString()
  }

  check(estimatedTokens) {
    // 每天凌晨重置
    const today = new Date().toDateString()
    if (today !== this.lastReset) {
      this.todaySpend = 0
      this.lastReset = today
    }

    const estimatedCost = calcCost('deepseek-chat', estimatedTokens, estimatedTokens * 2).totalCost

    if (estimatedCost > this.perRequestMax) {
      throw new Error(`单次请求预计费用 $${estimatedCost.toFixed(4)} 超过限制 $${this.perRequestMax}`)
    }
    if (this.todaySpend + estimatedCost > this.dailyBudget) {
      throw new Error(`今日累计费用已达到预算上限 $${this.dailyBudget}`)
    }

    return true
  }

  recordSpend(actualCost) {
    this.todaySpend += actualCost
  }
}

await testCostMonitor()
