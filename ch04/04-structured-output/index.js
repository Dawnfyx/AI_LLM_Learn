// 04-structured-output/index.js
// 用 Function Call 实现稳定的结构化数据提取
// withStructuredOutput 底层就是用 Function Call 强制模型返回符合 Schema 的 JSON
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { z } from 'zod'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0,
})

// ── 1. 从自然语言提取结构化数据 ──────────────────────────────

const ProjectSchema = z.object({
  name: z.string().describe('项目名称'),
  techStack: z.object({
    frontend: z.array(z.string()).describe('前端技术栈'),
    backend: z.array(z.string()).describe('后端技术栈'),
    database: z.array(z.string()).describe('数据库'),
    devops: z.array(z.string()).describe('DevOps 工具'),
  }),
  teamSize: z.number().describe('团队规模（人数）'),
  duration: z.string().describe('项目周期'),
  features: z.array(z.string()).describe('核心功能列表'),
  difficulty: z.enum(['初级', '中级', '高级', '专家级']).describe('项目难度评估'),
})

async function extractProjectInfo(description) {
  const structuredModel = model.withStructuredOutput(ProjectSchema)

  return structuredModel.invoke([
    new SystemMessage('从项目描述中提取结构化信息。'),
    new HumanMessage(description),
  ])
}

const desc1 = `
我们团队6个人用了3个月做了一个电商后台系统，
前端用 Vue3 + Vite + Element Plus，状态管理用 Pinia，
后端是 Node.js + Express + TypeScript，
数据库用 MySQL + Redis 做缓存，
用 Docker + Jenkins 部署到阿里云，
实现了商品管理、订单处理、用户权限、数据报表这些功能。
`

console.log('=== 1. 项目信息提取 ===')
const project = await extractProjectInfo(desc1)
console.log(JSON.stringify(project, null, 2))

// ── 2. 代码分析与评分 ────────────────────────────────────────

const CodeAnalysisSchema = z.object({
  overallScore: z.number().min(0).max(100).describe('综合质量评分'),
  issues: z.array(z.object({
    type: z.enum(['bug', 'performance', 'security', 'style', 'maintainability']),
    severity: z.enum(['critical', 'major', 'minor', 'info']),
    line: z.number().optional(),
    description: z.string(),
    suggestion: z.string(),
  })),
  positives: z.array(z.string()).describe('代码的优点'),
  summary: z.string().describe('一句话总结'),
})

async function analyzeCode(code, language = 'javascript') {
  const analysisModel = model.withStructuredOutput(CodeAnalysisSchema)

  return analysisModel.invoke([
    new SystemMessage(`你是资深 ${language} 代码审查专家，分析代码质量并给出具体建议。`),
    new HumanMessage(`分析以下代码：\n\`\`\`${language}\n${code}\n\`\`\``),
  ])
}

const badCode = `
async function loadData() {
  const res = await fetch('/api/users')
  const data = res.json()  // 忘记 await
  data.forEach(user => {
    document.getElementById('list').innerHTML += '<div>' + user.name + '</div>'  // XSS 风险 + 性能问题
  })
}

// 没有错误处理，每次都重新请求
setInterval(loadData, 1000)  // 没有清理
`

console.log('\n=== 2. 代码分析 ===')
const analysis = await analyzeCode(badCode, 'javascript')
console.log(JSON.stringify(analysis, null, 2))

// ── 3. 从招聘 JD 提取岗位要求 ────────────────────────────────

const JobRequirementsSchema = z.object({
  position: z.string(),
  level: z.enum(['junior', 'mid', 'senior', 'lead', 'principal']),
  mustHave: z.array(z.string()).describe('硬性要求（缺一不可）'),
  niceToHave: z.array(z.string()).describe('加分项'),
  techKeywords: z.array(z.string()).describe('所有技术关键词'),
  salaryRange: z.object({
    min: z.number().nullable(),
    max: z.number().nullable(),
    currency: z.string().default('CNY'),
  }).describe('薪资范围，万/年'),
  remotePolicy: z.enum(['onsite', 'hybrid', 'remote', 'unknown']),
})

async function parseJobDescription(jd) {
  const jdModel = model.withStructuredOutput(JobRequirementsSchema)

  return jdModel.invoke([
    new SystemMessage('从招聘JD中提取结构化的岗位要求。'),
    new HumanMessage(jd),
  ])
}

const jd = `
【高级前端工程师 - 深圳/可远程】薪资：30-50k/月

职责：
- 负责公司核心产品的前端架构设计和开发
- 攻克性能优化难题，保证核心页面 LCP < 2s
- 参与技术选型，推动前端工程化建设

要求：
- 3年以上前端开发经验，本科及以上学历
- 精通 Vue3 或 React，深刻理解响应式原理
- 熟悉 TypeScript，有大型项目实践经验
- 了解 Node.js，有 BFF 开发经验者优先
- 有微前端、低代码平台经验者加分
- 熟悉 Webpack/Vite 等构建工具
`

console.log('\n=== 3. JD 解析 ===')
const requirements = await parseJobDescription(jd)
console.log(JSON.stringify(requirements, null, 2))
