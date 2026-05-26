// 03-model-switch/index.js
// 模型抽象层：统一接口，随时切换 DeepSeek / OpenAI / 本地模型
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'

// ── 模型工厂 ─────────────────────────────────────────────────
// 通过配置切换模型，业务代码无需感知底层模型
class ModelFactory {
  static create(options = {}) {
    const {
      provider = process.env.AI_PROVIDER || 'deepseek',
      model,
      temperature = 0.7,
      streaming = false,
      callbacks = [],
    } = options

    const configs = {
      deepseek: {
        modelName: model || 'deepseek-chat',
        apiKey: process.env.DEEPSEEK_API_KEY,
        configuration: { baseURL: 'https://api.deepseek.com/v1' },
      },
      openai: {
        modelName: model || 'gpt-4o-mini',
        apiKey: process.env.OPENAI_API_KEY,
      },
      'openai-compatible': {
        // 接任何兼容 OpenAI API 的服务（本地 Ollama 等）
        modelName: model || process.env.LOCAL_MODEL || 'llama3',
        apiKey: process.env.LOCAL_API_KEY || 'not-needed',
        configuration: { baseURL: process.env.LOCAL_BASE_URL || 'http://localhost:11434/v1' },
      },
      qwen: {
        modelName: model || 'qwen-turbo',
        apiKey: process.env.QWEN_API_KEY,
        configuration: { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
      },
    }

    const cfg = configs[provider]
    if (!cfg) throw new Error(`不支持的模型提供商：${provider}`)

    return new ChatOpenAI({ ...cfg, temperature, streaming, callbacks })
  }

  // 按用途选择最合适的模型
  static forTask(task) {
    const taskModels = {
      'chat':          { provider: 'deepseek', model: 'deepseek-chat', temperature: 0.7 },
      'code':          { provider: 'deepseek', model: 'deepseek-chat', temperature: 0 },
      'reasoning':     { provider: 'deepseek', model: 'deepseek-reasoner', temperature: 0 },
      'classification':{ provider: 'deepseek', model: 'deepseek-chat', temperature: 0 },
      'embedding':     { provider: 'openai', model: 'text-embedding-3-small' },
      'fast':          { provider: 'openai', model: 'gpt-4o-mini', temperature: 0.3 },
    }

    const config = taskModels[task] || taskModels['chat']
    return this.create(config)
  }
}

// ── 带自动切换的模型管理器 ────────────────────────────────────
class ModelManager {
  constructor() {
    this.primary = null
    this.fallbacks = []
    this.currentIndex = 0
    this.failureCounts = new Map()
    this.circuitOpenUntil = new Map()   // 熔断器：失败过多则暂时停用
  }

  setPrimary(model) { this.primary = model; return this }
  addFallback(model) { this.fallbacks.push(model); return this }

  get models() { return [this.primary, ...this.fallbacks].filter(Boolean) }

  // 熔断检查
  isCircuitOpen(modelIndex) {
    const until = this.circuitOpenUntil.get(modelIndex)
    if (!until) return false
    if (Date.now() > until) {
      this.circuitOpenUntil.delete(modelIndex)  // 熔断恢复
      this.failureCounts.set(modelIndex, 0)
      return false
    }
    return true
  }

  // 记录失败，失败 3 次则熔断 1 分钟
  recordFailure(modelIndex) {
    const count = (this.failureCounts.get(modelIndex) || 0) + 1
    this.failureCounts.set(modelIndex, count)
    if (count >= 3) {
      this.circuitOpenUntil.set(modelIndex, Date.now() + 60000)
      console.warn(`[熔断] 模型 ${modelIndex} 已熔断 1 分钟`)
    }
  }

  async invoke(messages) {
    for (let i = 0; i < this.models.length; i++) {
      if (this.isCircuitOpen(i)) continue

      try {
        const result = await this.models[i].invoke(messages)
        if (i > 0) console.log(`[切换] 使用备用模型 ${i}`)
        this.failureCounts.set(i, 0)   // 成功后重置失败计数
        return result
      } catch (err) {
        this.recordFailure(i)
        console.warn(`[切换] 模型 ${i} 失败：${err.message}`)
        if (i === this.models.length - 1) throw err
      }
    }
    throw new Error('所有模型均不可用')
  }
}

// ── 动态模型切换（运行时切换，不重启服务）────────────────────
class DynamicModelRouter {
  constructor() {
    this.routes = {}    // feature → model config
    this.models = {}    // cacheKey → model instance
  }

  // 配置各功能使用的模型
  configure(routes) {
    this.routes = routes
    this.models = {}  // 清空缓存，下次调用时重建
    return this
  }

  getModel(feature) {
    const route = this.routes[feature] || this.routes['default']
    if (!route) throw new Error(`未配置 feature: ${feature}`)

    const key = JSON.stringify(route)
    if (!this.models[key]) {
      this.models[key] = ModelFactory.create(route)
    }
    return this.models[key]
  }

  async invoke(feature, messages) {
    return this.getModel(feature).invoke(messages)
  }
}

// ── 测试 ─────────────────────────────────────────────────────
async function testModelSwitch() {
  console.log('=== 模型切换测试 ===\n')

  // 工厂创建
  const chatModel = ModelFactory.forTask('chat')
  const codeModel = ModelFactory.forTask('code')
  console.log('chat 模型创建成功')
  console.log('code 模型创建成功（temperature=0）')

  // 动态路由
  const router = new DynamicModelRouter()
  router.configure({
    default: { provider: 'deepseek', model: 'deepseek-chat', temperature: 0.7 },
    coding:  { provider: 'deepseek', model: 'deepseek-chat', temperature: 0 },
    fast:    { provider: 'deepseek', model: 'deepseek-chat', temperature: 0.3 },
  })

  const result = await router.invoke('coding', [
    new SystemMessage('你是代码专家'),
    new HumanMessage('写一个 Vue3 的 ref 示例'),
  ])
  console.log('\n动态路由结果：', result.content.slice(0, 100))

  // 熔断器演示
  const manager = new ModelManager()
  manager
    .setPrimary(ModelFactory.create({ provider: 'deepseek' }))
    .addFallback(ModelFactory.create({ provider: 'deepseek', model: 'deepseek-chat' }))

  console.log('\n模型管理器创建成功，支持自动切换和熔断')
}

await testModelSwitch()
