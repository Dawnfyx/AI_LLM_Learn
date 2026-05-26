// 03-user-profile/index.js
// 用户画像记忆：跨会话持久化用户的偏好、技术背景、历史行为
// 这是"长期记忆"的核心——不同于会话记忆，它跨越多次对话持久存在
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { z } from 'zod'
import fs from 'fs/promises'
import path from 'path'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0,
})

// ── 用户画像 Schema ───────────────────────────────────────────
const UserProfileSchema = z.object({
  userId: z.string(),
  name: z.string().optional(),
  techStack: z.array(z.string()).default([]),
  experienceLevel: z.enum(['beginner', 'intermediate', 'senior', 'expert']).optional(),
  currentProjects: z.array(z.string()).default([]),
  preferredFrameworks: z.array(z.string()).default([]),
  learningGoals: z.array(z.string()).default([]),
  painPoints: z.array(z.string()).default([]),
  interactionCount: z.number().default(0),
  lastUpdated: z.string().default(() => new Date().toISOString()),
})

type UserProfile = z.infer<typeof UserProfileSchema>

// ── 用户画像存储（文件系统，生产用数据库）────────────────────
class UserProfileStore {
  constructor(dataDir = './data/profiles') {
    this.dataDir = dataDir
  }

  async init() {
    await fs.mkdir(this.dataDir, { recursive: true })
  }

  async get(userId) {
    const filePath = path.join(this.dataDir, `${userId}.json`)
    try {
      const data = await fs.readFile(filePath, 'utf-8')
      return UserProfileSchema.parse(JSON.parse(data))
    } catch {
      // 不存在则返回默认画像
      return UserProfileSchema.parse({ userId })
    }
  }

  async save(profile) {
    await this.init()
    const filePath = path.join(this.dataDir, `${profile.userId}.json`)
    await fs.writeFile(filePath, JSON.stringify(profile, null, 2))
  }
}

// ── 画像提取器：从对话中自动提取用户信息 ─────────────────────
const ExtractSchema = z.object({
  techStack: z.array(z.string()).describe('提到的技术栈'),
  experienceLevel: z.enum(['beginner', 'intermediate', 'senior', 'expert', 'unknown'])
    .describe('技术水平'),
  currentProjects: z.array(z.string()).describe('当前项目'),
  preferredFrameworks: z.array(z.string()).describe('偏好框架'),
  learningGoals: z.array(z.string()).describe('学习目标'),
  painPoints: z.array(z.string()).describe('痛点和困惑'),
  name: z.string().optional().describe('用户名字'),
})

async function extractProfileFromConversation(userMessage, assistantResponse) {
  const extractModel = model.withStructuredOutput(ExtractSchema)

  const result = await extractModel.invoke([
    new SystemMessage(`从对话中提取用户的技术背景信息。
只提取明确提到的信息，不要推断。没有提到的字段返回空数组或 'unknown'。`),
    new HumanMessage(`用户：${userMessage}\n助手：${assistantResponse}`),
  ])

  return result
}

// ── 画像合并：新提取的信息与已有画像合并 ─────────────────────
function mergeProfile(existing, extracted) {
  // 合并数组字段（去重）
  const mergeArrays = (a, b) => [...new Set([...a, ...b])]

  return {
    ...existing,
    name: extracted.name || existing.name,
    techStack: mergeArrays(existing.techStack, extracted.techStack),
    currentProjects: mergeArrays(existing.currentProjects, extracted.currentProjects),
    preferredFrameworks: mergeArrays(existing.preferredFrameworks, extracted.preferredFrameworks),
    learningGoals: mergeArrays(existing.learningGoals, extracted.learningGoals),
    painPoints: mergeArrays(existing.painPoints, extracted.painPoints),
    experienceLevel: extracted.experienceLevel !== 'unknown'
      ? extracted.experienceLevel
      : existing.experienceLevel,
    interactionCount: existing.interactionCount + 1,
    lastUpdated: new Date().toISOString(),
  }
}

// ── 个性化回复：根据用户画像调整回答风格 ─────────────────────
function buildPersonalizedSystemPrompt(profile) {
  const parts = ['你是前端开发助手。']

  if (profile.name) parts.push(`用户名：${profile.name}。`)

  if (profile.experienceLevel) {
    const levelMap = {
      beginner: '初学者，需要详细解释基础概念，多举例子',
      intermediate: '中级开发者，可以跳过基础，重点讲实践',
      senior: '资深开发者，直接讨论架构和最佳实践',
      expert: '专家，可以进行深度技术讨论',
    }
    parts.push(`技术水平：${levelMap[profile.experienceLevel] || profile.experienceLevel}。`)
  }

  if (profile.techStack.length > 0) {
    parts.push(`技术栈：${profile.techStack.join('、')}。`)
  }

  if (profile.currentProjects.length > 0) {
    parts.push(`当前项目：${profile.currentProjects.join('、')}。`)
  }

  if (profile.preferredFrameworks.length > 0) {
    parts.push(`偏好框架：${profile.preferredFrameworks.join('、')}，尽量用这些框架举例。`)
  }

  if (profile.learningGoals.length > 0) {
    parts.push(`学习目标：${profile.learningGoals.join('、')}。`)
  }

  if (profile.interactionCount > 0) {
    parts.push(`这是第 ${profile.interactionCount + 1} 次对话，可以基于历史上下文回答。`)
  }

  return parts.join('\n')
}

// ── 主演示 ────────────────────────────────────────────────────
async function demo() {
  const store = new UserProfileStore()
  await store.init()

  const userId = 'user_demo_001'
  let profile = await store.get(userId)

  console.log('=== 用户画像演示 ===\n')

  // 模拟多次对话，每次都更新画像
  const conversations = [
    {
      user: '我是小明，Vue2 用了 3 年了，现在想学 Vue3，感觉 Composition API 很难理解',
      assistant: '小明你好！Vue2 转 Vue3 的核心是理解 Composition API 的设计思想...',
    },
    {
      user: '我现在在做一个电商后台项目，用 Element Plus，想用 Pinia 管理状态',
      assistant: 'Pinia 配合 Vue3 非常好用，电商后台的典型状态管理场景...',
    },
    {
      user: '我还想学习 TypeScript，公司要求所有新项目用 TS',
      assistant: 'TypeScript + Vue3 的组合现在是主流，建议从这几个步骤开始...',
    },
  ]

  for (const conv of conversations) {
    console.log(`用户: ${conv.user.slice(0, 50)}...`)

    // 用当前画像生成个性化 system prompt
    const systemPrompt = buildPersonalizedSystemPrompt(profile)

    // 调用模型（这里用预设回答节省 API）
    // const response = await model.invoke([...])

    // 从对话中提取画像信息
    const extracted = await extractProfileFromConversation(conv.user, conv.assistant)
    console.log('提取信息：', JSON.stringify({
      techStack: extracted.techStack,
      level: extracted.experienceLevel,
      projects: extracted.currentProjects,
    }))

    // 更新画像
    profile = mergeProfile(profile, extracted)
    await store.save(profile)

    console.log(`画像更新：技术栈=${profile.techStack.join(',')}, 水平=${profile.experienceLevel}\n`)
  }

  console.log('\n=== 最终用户画像 ===')
  console.log(JSON.stringify(profile, null, 2))

  // 演示个性化 system prompt
  console.log('\n=== 生成的个性化系统提示 ===')
  console.log(buildPersonalizedSystemPrompt(profile))
}

await demo()
