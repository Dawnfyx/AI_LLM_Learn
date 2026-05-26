// 02-user-profile/index.js
// 用户画像：从对话中提取用户信息，持久化存储，每次对话自动注入
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'
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
const ProfileSchema = z.object({
  // 基础信息
  name:          z.string().optional().describe('用户姓名'),
  techLevel:     z.enum(['beginner', 'intermediate', 'senior']).optional(),
  yearsExp:      z.number().optional().describe('工作年限'),
  // 技术偏好
  primaryStack:  z.array(z.string()).default([]).describe('主要技术栈'),
  preferredLang: z.string().optional().describe('偏好的编程语言'),
  // 学习状态
  currentGoal:   z.string().optional().describe('当前学习目标'),
  knownTopics:   z.array(z.string()).default([]).describe('已掌握的知识点'),
  weakAreas:     z.array(z.string()).default([]).describe('薄弱领域'),
  // 行为偏好
  prefersCode:   z.boolean().optional().describe('是否偏好代码示例'),
  prefersShort:  z.boolean().optional().describe('是否偏好简短回答'),
})

// ── 用户画像管理器 ────────────────────────────────────────────
class UserProfileManager {
  constructor(storePath = './profiles') {
    this.storePath = storePath
  }

  profilePath(userId) {
    return path.join(this.storePath, `${userId}.json`)
  }

  async load(userId) {
    try {
      await fs.mkdir(this.storePath, { recursive: true })
      const data = await fs.readFile(this.profilePath(userId), 'utf-8')
      return JSON.parse(data)
    } catch {
      return ProfileSchema.parse({})   // 返回空白画像
    }
  }

  async save(userId, profile) {
    await fs.mkdir(this.storePath, { recursive: true })
    await fs.writeFile(
      this.profilePath(userId),
      JSON.stringify(profile, null, 2),
      'utf-8'
    )
  }

  // 从新的对话轮次中提取信息，增量更新画像
  async extract(userId, userMessage, aiReply) {
    const current = await this.load(userId)

    const ExtractSchema = z.object({
      updates: z.object({
        name:          z.string().optional(),
        techLevel:     z.enum(['beginner', 'intermediate', 'senior']).optional(),
        yearsExp:      z.number().optional(),
        primaryStack:  z.array(z.string()).optional(),
        preferredLang: z.string().optional(),
        currentGoal:   z.string().optional(),
        newKnownTopics: z.array(z.string()).optional().describe('新学到的知识点'),
        weakAreas:     z.array(z.string()).optional(),
        prefersCode:   z.boolean().optional(),
        prefersShort:  z.boolean().optional(),
      }).describe('从对话中发现的新信息，只填写有明确证据的字段'),
      hasNewInfo: z.boolean().describe('这轮对话是否包含新的用户信息'),
    })

    const extractModel = model.withStructuredOutput(ExtractSchema)
    const result = await extractModel.invoke([
      new SystemMessage(`从对话中提取用户信息，更新用户画像。
当前画像：${JSON.stringify(current)}
只提取有明确依据的信息，不要猜测。`),
      new HumanMessage(`用户说：${userMessage}\nAI回复：${aiReply}`),
    ])

    if (!result.hasNewInfo) return current

    // 增量合并：数组字段追加，不覆盖
    const updated = { ...current }
    const u = result.updates

    if (u.name)          updated.name = u.name
    if (u.techLevel)     updated.techLevel = u.techLevel
    if (u.yearsExp)      updated.yearsExp = u.yearsExp
    if (u.preferredLang) updated.preferredLang = u.preferredLang
    if (u.currentGoal)   updated.currentGoal = u.currentGoal
    if (u.prefersCode !== undefined) updated.prefersCode = u.prefersCode
    if (u.prefersShort !== undefined) updated.prefersShort = u.prefersShort

    // 数组字段去重追加
    if (u.primaryStack?.length) {
      updated.primaryStack = [...new Set([...(current.primaryStack || []), ...u.primaryStack])]
    }
    if (u.newKnownTopics?.length) {
      updated.knownTopics = [...new Set([...(current.knownTopics || []), ...u.newKnownTopics])]
    }
    if (u.weakAreas?.length) {
      updated.weakAreas = [...new Set([...(current.weakAreas || []), ...u.weakAreas])]
    }

    await this.save(userId, updated)
    console.log(`  [画像更新] ${userId}：`, JSON.stringify(u).slice(0, 100))
    return updated
  }

  // 把画像转成 system 提示词
  toSystemContext(profile) {
    const parts = []
    if (profile.name) parts.push(`用户名：${profile.name}`)
    if (profile.techLevel) {
      const levelMap = { beginner: '初学者', intermediate: '中级', senior: '资深' }
      parts.push(`技术水平：${levelMap[profile.techLevel]}`)
    }
    if (profile.yearsExp) parts.push(`工作年限：${profile.yearsExp}年`)
    if (profile.primaryStack?.length) parts.push(`技术栈：${profile.primaryStack.join(', ')}`)
    if (profile.currentGoal) parts.push(`当前目标：${profile.currentGoal}`)
    if (profile.knownTopics?.length) parts.push(`已掌握：${profile.knownTopics.join(', ')}`)
    if (profile.weakAreas?.length) parts.push(`薄弱点：${profile.weakAreas.join(', ')}`)
    if (profile.prefersCode) parts.push('偏好：代码示例')
    if (profile.prefersShort) parts.push('偏好：简短回答')

    return parts.length
      ? `\n\n用户信息：\n${parts.map(p => `- ${p}`).join('\n')}`
      : ''
  }
}

// ── 带用户画像的对话类 ────────────────────────────────────────
class PersonalizedChat {
  constructor(userId) {
    this.userId = userId
    this.profileMgr = new UserProfileManager()
    this.history = []
  }

  async chat(userInput) {
    const profile = await this.profileMgr.load(this.userId)
    const profileCtx = this.profileMgr.toSystemContext(profile)

    this.history.push(new HumanMessage(userInput))

    const res = await model.invoke([
      new SystemMessage(`你是前端开发导师，根据用户画像个性化回答。${profileCtx}`),
      ...this.history,
    ])

    this.history.push(new AIMessage(res.content))

    // 异步更新画像（不阻塞回复）
    this.profileMgr.extract(this.userId, userInput, res.content).catch(() => {})

    return res.content
  }
}

// 测试
async function testPersonalization() {
  console.log('=== 用户画像测试 ===\n')

  const chat = new PersonalizedChat('user-alice')

  // 第一轮：介绍自己
  const r1 = await chat.chat('我叫 Alice，Vue3 工作3年，目前在学微前端架构')
  console.log('R1:', r1.slice(0, 120))

  // 第二轮：提问（模型应该知道是 Vue3 开发者，给出有针对性的回答）
  const r2 = await chat.chat('qiankun 和 wujie 哪个更适合我的场景？')
  console.log('\nR2:', r2.slice(0, 150))

  // 查看保存的画像
  const mgr = new UserProfileManager()
  const profile = await mgr.load('user-alice')
  console.log('\n保存的用户画像：', JSON.stringify(profile, null, 2))
}

await testPersonalization()
