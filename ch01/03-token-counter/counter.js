// counter.js
// Token 估算工具（无需 tiktoken，基于统计规律）
// 规律：英文约 1 token ≈ 4 字符；中文约 1 token ≈ 1.5~2 字符

export function estimateTokens(text) {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length
  const otherChars = text.length - chineseChars
  return Math.ceil(chineseChars * 0.6 + otherChars * 0.25)
}

// 各模型价格（单位：USD / 1M tokens）
const PRICING = {
  'deepseek-chat':    { input: 0.27,  output: 1.10 },
  'gpt-4o':          { input: 2.50,  output: 10.0 },
  'gpt-4o-mini':     { input: 0.15,  output: 0.60 },
  'claude-3-5-sonnet':{ input: 3.00,  output: 15.0 },
}

export function estimateCost(inputTokens, outputTokens, model = 'deepseek-chat') {
  const price = PRICING[model] ?? PRICING['deepseek-chat']
  const inputCost  = (inputTokens  / 1_000_000) * price.input
  const outputCost = (outputTokens / 1_000_000) * price.output
  return {
    inputCost:  inputCost.toFixed(6),
    outputCost: outputCost.toFixed(6),
    totalCost:  (inputCost + outputCost).toFixed(6),
    totalCNY:   ((inputCost + outputCost) * 7.2).toFixed(4),
  }
}

// 示例
const prompt = '你是一位前端开发导师。请解释 Vue3 的 Composition API 和 Options API 的区别。'
const inputTokens = estimateTokens(prompt)
console.log(`Prompt Token 估算：${inputTokens}`)

const cost = estimateCost(inputTokens, 300, 'deepseek-chat')
console.log(`成本估算（输入${inputTokens} + 输出300 tokens）：`)
console.log(`  费用：$${cost.totalCost} ≈ ¥${cost.totalCNY}`)
