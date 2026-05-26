// 04-ab-testing/index.js
// Prompt A/B 测试：比较不同 Prompt 或模型的效果
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { z } from 'zod'
import fs from 'fs/promises'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0,
})

// ── A/B 测试框架 ──────────────────────────────────────────────
class AbTestManager {
  constructor() {
    this.experiments = new Map()   // experimentId → config
    this.assignments = new Map()   // userId → { expId, variant }
    this.results = []              // 所有实验结果
  }

  // 注册实验
  register(experimentId, { variants, splitRatio = 0.5, description = '' }) {
    this.experiments.set(experimentId, {
      id: experimentId,
      description,
      variants,       // { A: config, B: config }
      splitRatio,     // A 组的流量比例
      startTime: new Date().toISOString(),
      metrics: { A: [], B: [] },
    })
    return this
  }

  // 给用户分配变体（同一用户始终在同一组）
  assign(userId, experimentId) {
    const key = `${userId}:${experimentId}`
    if (this.assignments.has(key)) {
      return this.assignments.get(key).variant
    }

    const exp = this.experiments.get(experimentId)
    if (!exp) throw new Error(`实验 ${experimentId} 不存在`)

    // 用 userId hash 确保分组稳定（同一用户多次访问结果一致）
    const hash = userId.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) & 0xFFFFFFFF, 0)
    const variant = (hash / 0xFFFFFFFF) < exp.splitRatio ? 'A' : 'B'

    this.assignments.set(key, { variant, experimentId })
    return variant
  }

  // 获取该用户在该实验中的变体配置
  getConfig(userId, experimentId) {
    const variant = this.assign(userId, experimentId)
    const exp = this.experiments.get(experimentId)
    return { variant, config: exp.variants[variant] }
  }

  // 记录指标
  recordMetric(userId, experimentId, metric) {
    const variant = this.assign(userId, experimentId)
    const exp = this.experiments.get(experimentId)
    if (!exp) return

    exp.metrics[variant].push({ ...metric, userId, timestamp: new Date().toISOString() })
    this.results.push({ experimentId, variant, ...metric, userId })
  }

  // 统计分析
  analyze(experimentId) {
    const exp = this.experiments.get(experimentId)
    if (!exp) return null

    const calcStats = (metrics) => {
      if (!metrics.length) return { count: 0 }
      const scores = metrics.map(m => m.score).filter(s => s != null)
      const latencies = metrics.map(m => m.latencyMs).filter(l => l != null)
      const tokenCounts = metrics.map(m => m.tokens).filter(t => t != null)

      return {
        count: metrics.length,
        avgScore: scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : null,
        avgLatencyMs: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
        avgTokens: tokenCounts.length ? Math.round(tokenCounts.reduce((a, b) => a + b, 0) / tokenCounts.length) : null,
      }
    }

    return {
      experimentId,
      description: exp.description,
      startTime: exp.startTime,
      A: calcStats(exp.metrics.A),
      B: calcStats(exp.metrics.B),
      winner: this._determineWinner(exp.metrics),
    }
  }

  _determineWinner(metrics) {
    const aScores = metrics.A.map(m => m.score).filter(Boolean)
    const bScores = metrics.B.map(m => m.score).filter(Boolean)

    if (!aScores.length || !bScores.length) return 'insufficient_data'

    const aAvg = aScores.reduce((a, b) => a + b, 0) / aScores.length
    const bAvg = bScores.reduce((a, b) => a + b, 0) / bScores.length

    if (Math.abs(aAvg - bAvg) < 0.5) return 'no_significant_difference'
    return aAvg > bAvg ? 'A' : 'B'
  }

  async saveResults(filepath = './ab-results.json') {
    const report = {}
    for (const [id] of this.experiments) {
      report[id] = this.analyze(id)
    }
    await fs.writeFile(filepath, JSON.stringify(report, null, 2))
    return report
  }
}

// ── Prompt 质量评估器 ─────────────────────────────────────────
async function evaluateResponse(question, response) {
  const EvalSchema = z.object({
    relevance:   z.number().min(1).max(5).describe('回答相关性'),
    accuracy:    z.number().min(1).max(5).describe('技术准确性'),
    clarity:     z.number().min(1).max(5).describe('表达清晰度'),
    codeQuality: z.number().min(1).max(5).describe('代码示例质量（如有）'),
    overall:     z.number().min(1).max(5).describe('综合评分'),
    reason:      z.string().describe('评分理由（一句话）'),
  })

  const evalModel = model.withStructuredOutput(EvalSchema)
  return evalModel.invoke([
    new SystemMessage('你是 AI 回答质量评估专家，对回答进行客观评分。'),
    new HumanMessage(`
问题：${question}

回答：${response.slice(0, 500)}

请对这个回答进行评分（1-5分）。`),
  ])
}

// ── 运行 A/B 测试 ─────────────────────────────────────────────
async function runAbTest() {
  console.log('=== Prompt A/B 测试 ===\n')

  const manager = new AbTestManager()

  // 注册实验：比较两种 system prompt 哪个更好
  manager.register('system-prompt-v2', {
    description: '比较简洁版和详细版 system prompt 的效果',
    variants: {
      A: {
        systemPrompt: '你是前端助手，回答简洁。',
        name: '简洁版',
      },
      B: {
        systemPrompt: `你是资深前端开发助手。
回答要求：先给出核心概念，再用代码示例说明，最后提供最佳实践建议。`,
        name: '详细版',
      },
    },
    splitRatio: 0.5,
  })

  // 测试用例
  const testCases = [
    'Vue3 中 ref 和 reactive 怎么选择？',
    'React 的 useCallback 什么时候用？',
    'TypeScript 的泛型怎么理解？',
  ]

  const testUsers = ['user-001', 'user-002', 'user-003', 'user-004', 'user-005']

  for (const userId of testUsers) {
    const { variant, config } = manager.getConfig(userId, 'system-prompt-v2')
    const question = testCases[Math.floor(Math.random() * testCases.length)]

    console.log(`用户 ${userId} → 变体 ${variant} (${config.name})`)

    const start = Date.now()
    const res = await model.invoke([
      new SystemMessage(config.systemPrompt),
      new HumanMessage(question),
    ])
    const latencyMs = Date.now() - start

    // 评估回答质量
    const evaluation = await evaluateResponse(question, res.content)

    // 记录指标
    manager.recordMetric(userId, 'system-prompt-v2', {
      question,
      latencyMs,
      tokens: (res.content.length * 0.5) | 0,
      score: evaluation.overall,
      scores: evaluation,
    })

    console.log(`  评分：${evaluation.overall}/5，延迟：${latencyMs}ms`)
  }

  // 分析结果
  console.log('\n=== 实验分析结果 ===')
  const analysis = manager.analyze('system-prompt-v2')
  console.log(JSON.stringify(analysis, null, 2))

  return analysis
}

await runAbTest()
