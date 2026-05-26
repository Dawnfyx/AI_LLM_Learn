// Few-shot 提示：通过示例教会模型输出固定格式
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0,
})

// 场景：从自然语言中提取组件规格说明
async function extractComponentSpec(userRequest) {
  const messages = [
    new SystemMessage('你是一位前端架构师，将需求描述转换为组件规格说明，输出纯 JSON，不加任何解释。'),
    // 示例 1
    new HumanMessage('做一个带 loading 状态的搜索框，支持防抖'),
    new AIMessage(JSON.stringify({
      name: 'SearchInput',
      props: [
        { name: 'placeholder', type: 'string', default: '请输入关键词' },
        { name: 'debounce', type: 'number', default: 300 },
      ],
      emits: ['search', 'clear'],
      features: ['防抖处理', 'loading 状态', '清空按钮'],
    }, null, 2)),
    // 示例 2
    new HumanMessage('做一个支持跳页的分页组件'),
    new AIMessage(JSON.stringify({
      name: 'Pagination',
      props: [
        { name: 'total', type: 'number', required: true },
        { name: 'pageSize', type: 'number', default: 10 },
        { name: 'current', type: 'number', default: 1 },
      ],
      emits: ['change'],
      features: ['页码跳转', '边界禁用', '总页数计算'],
    }, null, 2)),
    // 实际请求
    new HumanMessage(userRequest),
  ]

  const res = await model.invoke(messages)
  try {
    return JSON.parse(res.content)
  } catch {
    return res.content
  }
}

const spec = await extractComponentSpec(
  '做一个日期范围选择器，支持快捷选项：近7天、近30天、本月'
)
console.log(JSON.stringify(spec, null, 2))
