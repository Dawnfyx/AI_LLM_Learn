// 02-prompt-template/index.js
// LangChain.js 提示词模板：ChatPromptTemplate、变量插值、partial 填充
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { ChatPromptTemplate, PromptTemplate } from '@langchain/core/prompts'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0.3,
})

// ── 1. ChatPromptTemplate 基础用法 ───────────────────────────
async function basicTemplate() {
  console.log('\n=== 1. ChatPromptTemplate ===')

  // 定义模板——{变量} 是占位符
  const prompt = ChatPromptTemplate.fromMessages([
    ['system', '你是一位{role}，擅长{skill}。回答语言：{language}。'],
    ['human', '{question}'],
  ])

  // 格式化模板：传入变量值 → 得到 messages 数组
  const messages = await prompt.formatMessages({
    role: '资深前端架构师',
    skill: 'Vue3 和性能优化',
    language: '中文',
    question: '大型 Vue3 项目应该怎么做状态管理？',
  })

  console.log('格式化后的 messages：', JSON.stringify(messages, null, 2))

  const res = await model.invoke(messages)
  console.log('回复：', res.content.slice(0, 150))
}

// ── 2. 模板复用：同一个模板，不同的变量 ─────────────────────
async function templateReuse() {
  console.log('\n=== 2. 模板复用 ===')

  const codeReviewPrompt = ChatPromptTemplate.fromMessages([
    ['system', `你是{lang}代码审查专家。
审查维度：{aspects}
输出格式：JSON，结构为 {{ "score": number, "issues": string[], "suggestions": string[] }}`],
    ['human', '审查这段代码：\n```{lang}\n{code}\n```'],
  ])

  const vueCode = `
const count = ref(0)
setInterval(() => { count.value++ }, 1000)
// 没有在 onUnmounted 里清除定时器
`

  const reactCode = `
function UserList() {
  const [users, setUsers] = useState([])
  useEffect(() => {
    fetch('/api/users').then(r => r.json()).then(setUsers)
  }) // 缺少依赖数组，每次渲染都会发请求
}
`

  // 复用同一个模板，审查不同语言的代码
  const [vueResult, reactResult] = await Promise.all([
    model.invoke(await codeReviewPrompt.formatMessages({
      lang: 'Vue3',
      aspects: '内存泄漏、生命周期管理',
      code: vueCode,
    })),
    model.invoke(await codeReviewPrompt.formatMessages({
      lang: 'React',
      aspects: '性能问题、Hook 使用规范',
      code: reactCode,
    })),
  ])

  const parseJSON = (text) => {
    try {
      return JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim())
    } catch { return text }
  }

  console.log('Vue3 审查结果：', JSON.stringify(parseJSON(vueResult.content), null, 2))
  console.log('React 审查结果：', JSON.stringify(parseJSON(reactResult.content), null, 2))
}

// ── 3. Partial 模板：预填部分变量 ───────────────────────────
async function partialTemplate() {
  console.log('\n=== 3. Partial 预填变量 ===')

  const basePrompt = ChatPromptTemplate.fromMessages([
    ['system', '你是{company}的{role}，用{tone}的语气回答。'],
    ['human', '{question}'],
  ])

  // partial：预填固定的变量，生成一个新的模板
  // 适合场景：不同页面/模块共用基础人设，但问题不同
  const customerServicePrompt = basePrompt.partial({
    company: '极速购电商平台',
    role: '客服助手',
    tone: '热情友好',
  })

  const technicalPrompt = basePrompt.partial({
    company: '极速购电商平台',
    role: '技术支持工程师',
    tone: '专业严谨',
  })

  const [r1, r2] = await Promise.all([
    model.invoke(await customerServicePrompt.formatMessages({
      question: '我的订单什么时候发货？',
    })),
    model.invoke(await technicalPrompt.formatMessages({
      question: '为什么接口返回 401 错误？',
    })),
  ])

  console.log('客服回复：', r1.content.slice(0, 100))
  console.log('技术支持：', r2.content.slice(0, 100))
}

// ── 4. 从文件加载模板 ────────────────────────────────────────
async function fromFile() {
  console.log('\n=== 4. 动态模板（模拟从配置加载）===')

  // 实际项目中可以从数据库或文件读取模板字符串
  const templateConfig = {
    id: 'frontend-mentor',
    system: '你是一位{expertise}方向的前端导师，教学风格：{style}。',
    user: '学生问题：{question}\n学生当前水平：{level}',
  }

  const dynamicPrompt = ChatPromptTemplate.fromMessages([
    ['system', templateConfig.system],
    ['human', templateConfig.user],
  ])

  const res = await model.invoke(await dynamicPrompt.formatMessages({
    expertise: 'Vue3 源码解析',
    style: '循序渐进，多举例子',
    question: 'computed 是怎么实现缓存的？',
    level: '了解 Vue3 基础用法，但没读过源码',
  }))

  console.log('动态模板回复：', res.content.slice(0, 200))
}

await basicTemplate()
await templateReuse()
await partialTemplate()
await fromFile()
