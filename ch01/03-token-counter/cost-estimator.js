// cost-estimator.js
// 对比不同模型在同一任务上的成本
import { estimateTokens, estimateCost } from './counter.js'

const models = ['deepseek-chat', 'gpt-4o-mini', 'gpt-4o', 'claude-3-5-sonnet']

// 模拟一个典型的智能客服对话：平均输入 800 tokens，输出 300 tokens
const INPUT_TOKENS = 800
const OUTPUT_TOKENS = 300
// 假设每天 1000 次对话
const DAILY_CALLS = 1000

console.log('=== 成本对比（每次对话）===\n')
console.log('模型'.padEnd(22), '单次费用(USD)', '日费用(USD)', '月费用(CNY)')
console.log('-'.repeat(70))

for (const model of models) {
  const cost = estimateCost(INPUT_TOKENS, OUTPUT_TOKENS, model)
  const totalPerCall = parseFloat(cost.totalCost)
  const dailyCost = (totalPerCall * DAILY_CALLS).toFixed(4)
  const monthlyCNY = (totalPerCall * DAILY_CALLS * 30 * 7.2).toFixed(2)
  console.log(
    model.padEnd(22),
    `$${cost.totalCost}`.padEnd(16),
    `$${dailyCost}`.padEnd(12),
    `¥${monthlyCNY}`
  )
}
