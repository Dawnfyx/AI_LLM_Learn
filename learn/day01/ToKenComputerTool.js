// cost-estimator.js
export function estimateTokens(text) {
  const cnChars = (text.match(/[\u4e00-\u9fff]/g) || []).length
  const otherChars = text.length - cnChars
  // 中文约 0.6 token/字，其他约 0.25 token/字符
  return Math.ceil(cnChars * 0.6 + otherChars * 0.25)
}

const PRICING = {
  'deepseek-chat': { input: 0.27,  output: 1.10 },
  'gpt-4o':        { input: 2.50,  output: 10.0 },
  'gpt-4o-mini':   { input: 0.15,  output: 0.60 },
}

export function estimateCost(inputTokens, outputTokens, model = 'deepseek-chat') {
  const p = PRICING[model]
  const total = (inputTokens / 1e6) * p.input + (outputTokens / 1e6) * p.output
  return {
    usd: total.toFixed(6),
    cny: (total * 7.2).toFixed(4),
  }
}