// 04-long-term-storage/index.js
// 长期记忆存储：用 MySQL 持久化跨会话的记忆片段
// 记忆片段（Memory）= 结构化的"用户信息"或"重要事件"
import 'dotenv/config'
import mysql from 'mysql2/promise'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { z } from 'zod'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0,
})

// ── 数据库初始化 ──────────────────────────────────────────────
async function initDatabase(conn) {
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS memories (
      id          BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id     VARCHAR(64) NOT NULL,
      content     TEXT NOT NULL,
      category    VARCHAR(32) NOT NULL COMMENT 'preference|fact|goal|event',
      importance  TINYINT DEFAULT 3 COMMENT '1-5, 5最重要',
      source_turn INT DEFAULT 0 COMMENT '来自第几轮对话',
      tags        JSON,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_user_category (user_id, category),
      INDEX idx_importance (user_id, importance DESC)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS conversation_sessions (
      id           BIGINT AUTO_INCREMENT PRIMARY KEY,
      session_id   VARCHAR(64) UNIQUE NOT NULL,
      user_id      VARCHAR(64) NOT NULL,
      title        VARCHAR(200),
      message_count INT DEFAULT 0,
      started_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_active  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
}

// ── 记忆管理器 ────────────────────────────────────────────────
class LongTermMemoryStore {
  constructor(conn) {
    this.conn = conn
  }

  // 存入一条记忆
  async addMemory(userId, { content, category, importance = 3, sourceTurn = 0, tags = [] }) {
    const [result] = await this.conn.execute(
      `INSERT INTO memories (user_id, content, category, importance, source_turn, tags)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, content, category, importance, sourceTurn, JSON.stringify(tags)]
    )
    return result.insertId
  }

  // 获取用户的所有记忆（按重要性排序）
  async getMemories(userId, { category, limit = 20, minImportance = 1 } = {}) {
    let sql = `SELECT * FROM memories
               WHERE user_id = ? AND importance >= ?`
    const params = [userId, minImportance]

    if (category) { sql += ' AND category = ?'; params.push(category) }
    sql += ' ORDER BY importance DESC, updated_at DESC LIMIT ?'
    params.push(limit)

    const [rows] = await this.conn.execute(sql, params)
    return rows
  }

  // 关键词搜索记忆（简单版，生产用向量搜索）
  async searchMemories(userId, keyword, limit = 5) {
    const [rows] = await this.conn.execute(
      `SELECT * FROM memories
       WHERE user_id = ? AND content LIKE ?
       ORDER BY importance DESC LIMIT ?`,
      [userId, `%${keyword}%`, limit]
    )
    return rows
  }

  // 更新记忆重要性（用户反复提到的事情，重要性+1）
  async boostImportance(memoryId) {
    await this.conn.execute(
      'UPDATE memories SET importance = LEAST(importance + 1, 5) WHERE id = ?',
      [memoryId]
    )
  }

  // 删除记忆
  async deleteMemory(memoryId, userId) {
    await this.conn.execute(
      'DELETE FROM memories WHERE id = ? AND user_id = ?',
      [memoryId, userId]
    )
  }

  // 构建记忆摘要（注入 system prompt 用）
  async buildMemoryContext(userId) {
    const memories = await this.getMemories(userId, { limit: 15, minImportance: 2 })
    if (memories.length === 0) return ''

    const grouped = {}
    for (const m of memories) {
      if (!grouped[m.category]) grouped[m.category] = []
      grouped[m.category].push(m.content)
    }

    const parts = []
    const categoryNames = {
      preference: '偏好', fact: '基本信息',
      goal: '目标', event: '重要事件',
    }
    for (const [cat, items] of Object.entries(grouped)) {
      parts.push(`【${categoryNames[cat] || cat}】${items.join('；')}`)
    }

    return parts.join('\n')
  }
}

// ── 记忆提取器：从对话中自动识别值得记住的信息 ───────────────
const MemoryExtractSchema = z.object({
  memories: z.array(z.object({
    content: z.string().describe('记忆内容，一句话描述'),
    category: z.enum(['preference', 'fact', 'goal', 'event']),
    importance: z.number().min(1).max(5).describe('重要性 1-5，5最重要'),
    tags: z.array(z.string()).describe('标签，如 vue3、状态管理'),
  })).describe('值得长期记住的信息列表，没有则返回空数组'),
})

async function extractMemoriesFromTurn(userMessage, assistantResponse) {
  const extractModel = model.withStructuredOutput(MemoryExtractSchema)

  const result = await extractModel.invoke([
    new SystemMessage(`从对话中识别值得长期记住的用户信息。

值得记住的类型：
- preference：用户偏好（喜欢用什么工具、框架风格）
- fact：客观事实（用了几年、在做什么项目、用什么技术栈）  
- goal：用户目标（想学什么、想解决什么问题）
- event：重要事件（完成了某个项目、解决了某个难题）

不值得记住的：临时问题、一般性知识查询。`),
    new HumanMessage(`对话：\n用户：${userMessage}\n助手：${assistantResponse}`),
  ])

  return result.memories
}

// ── 主演示 ────────────────────────────────────────────────────
async function demo() {
  let conn
  try {
    conn = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || 'password',
      database: process.env.DB_NAME || 'ai_memory',
    })

    await initDatabase(conn)
    const store = new LongTermMemoryStore(conn)
    const userId = 'user_test_001'

    console.log('=== 长期记忆存储演示 ===\n')

    // 模拟几轮对话，自动提取记忆
    const conversations = [
      { user: '我是做前端的，工作3年了，主要用 Vue3', assistant: '您好！Vue3 的哪个方面想深入了解？' },
      { user: '我想在年底前学会 TypeScript，公司要求', assistant: 'TypeScript 学习路线建议...' },
      { user: '我现在在做一个医疗 SaaS 项目，性能要求很高', assistant: '医疗 SaaS 的性能优化...' },
    ]

    for (let i = 0; i < conversations.length; i++) {
      const { user, assistant } = conversations[i]
      console.log(`第 ${i + 1} 轮对话...`)

      const memories = await extractMemoriesFromTurn(user, assistant)
      for (const mem of memories) {
        const id = await store.addMemory(userId, { ...mem, sourceTurn: i + 1 })
        console.log(`  存入记忆 [${mem.category}] 重要性${mem.importance}: ${mem.content}`)
      }
    }

    // 查看存储的记忆
    console.log('\n=== 用户记忆库 ===')
    const allMemories = await store.getMemories(userId)
    allMemories.forEach(m => {
      console.log(`[${m.category}] ★${m.importance} ${m.content}`)
    })

    // 搜索特定记忆
    console.log('\n=== 搜索"TypeScript"相关记忆 ===')
    const tsMemories = await store.searchMemories(userId, 'TypeScript')
    tsMemories.forEach(m => console.log(`  ${m.content}`))

    // 构建记忆上下文
    console.log('\n=== 记忆上下文（注入 system prompt）===')
    const ctx = await store.buildMemoryContext(userId)
    console.log(ctx)

  } catch (e) {
    console.error('数据库连接失败（需要 MySQL）：', e.message)
    console.log('\n演示文件模拟存储版本：\n')

    // 无数据库时演示内存版本
    const mockMemories = [
      { category: 'fact', importance: 4, content: '前端工程师，3年工作经验，主用 Vue3' },
      { category: 'goal', importance: 5, content: '年底前学会 TypeScript（公司要求）' },
      { category: 'fact', importance: 4, content: '当前项目：医疗 SaaS，性能要求高' },
    ]

    console.log('模拟记忆库：')
    mockMemories.forEach(m => console.log(`  [${m.category}] ★${m.importance} ${m.content}`))

    const ctx = mockMemories
      .map(m => `【${m.category}】${m.content}`)
      .join('\n')
    console.log('\n记忆上下文：\n', ctx)
  } finally {
    if (conn) await conn.end()
  }
}

await demo()
