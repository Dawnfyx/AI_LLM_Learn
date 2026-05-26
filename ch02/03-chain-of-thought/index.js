// Chain of Thought：让模型一步步思考，再给出结论
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0.2,
})

async function analyzeArchitecture(requirement) {
  // 无 CoT：直接给答案
  const direct = await model.invoke([
    new HumanMessage(`企业知识库系统用什么技术栈？要求：50人团队，前端熟悉 Vue3+Node.js，需要 AI 问答`),
  ])

  // 有 CoT：引导模型分步骤思考
  const cot = await model.invoke([
    new SystemMessage(`你是一位资深架构师。分析技术方案时，请严格按以下步骤：
【第一步】拆解核心需求和约束
【第二步】列出 2-3 个可选方案的优缺点
【第三步】给出推荐方案和具体理由
【第四步】列出实施的关键风险点`),
    new HumanMessage(requirement),
  ])

  console.log('=== 直接回答 ===')
  console.log(direct.content)
  console.log('\n\n=== 思维链分析 ===')
  console.log(cot.content)
}

analyzeArchitecture(`
需求：为 50 人技术团队搭建内部知识库系统
- 功能：Markdown 编写、全文搜索、权限管理（部门隔离）、AI 问答
- 团队技术栈：Vue3 + Node.js，无 Python 经验
- 约束：预算有限，优先开源方案，3 个月内上线
`)
