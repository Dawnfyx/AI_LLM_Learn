// 01-project-architecture/README.md 对应的代码结构说明
// 这个文件展示一个生产级 LLM 应用的完整项目结构

/*
project-root/
├── apps/
│   ├── server/                    Node.js 后端
│   │   ├── src/
│   │   │   ├── config/
│   │   │   │   ├── index.js       统一配置入口
│   │   │   │   ├── model.js       模型配置
│   │   │   │   └── database.js    数据库连接
│   │   │   ├── routes/
│   │   │   │   ├── chat.js        对话路由
│   │   │   │   ├── knowledge.js   知识库路由
│   │   │   │   └── health.js      健康检查
│   │   │   ├── middleware/
│   │   │   │   ├── auth.js        认证
│   │   │   │   ├── rateLimit.js   限流
│   │   │   │   ├── validate.js    输入校验
│   │   │   │   └── security.js    安全检查
│   │   │   ├── services/
│   │   │   │   ├── chat/
│   │   │   │   │   ├── agent.js   Agent 逻辑
│   │   │   │   │   └── memory.js  记忆管理
│   │   │   │   ├── rag/
│   │   │   │   │   ├── ingest.js  文档入库
│   │   │   │   │   └── query.js   RAG 查询
│   │   │   │   └── cache.js       缓存服务
│   │   │   ├── utils/
│   │   │   │   ├── logger.js      结构化日志
│   │   │   │   ├── tracer.js      链路追踪
│   │   │   │   ├── tokens.js      Token 估算
│   │   │   │   └── cost.js        成本计算
│   │   │   └── index.js           应用入口
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   └── web/                       Vue3 / React 前端
│       ├── src/
│       │   ├── composables/       Vue3 组合式函数
│       │   ├── components/        UI 组件
│       │   ├── stores/            Pinia 状态
│       │   └── views/             页面
│       ├── Dockerfile
│       └── package.json
│
├── packages/                      共享包（monorepo）
│   ├── shared-types/              TypeScript 类型定义
│   └── shared-utils/              共享工具函数
│
├── docker-compose.yml
├── docker-compose.prod.yml
└── .env.example
*/

// ── 统一配置管理 ──────────────────────────────────────────────
// src/config/index.js
export const config = {
  app: {
    port: Number(process.env.PORT) || 3000,
    env: process.env.NODE_ENV || 'development',
    version: process.env.APP_VERSION || '1.0.0',
    allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173'],
  },
  ai: {
    provider: process.env.AI_PROVIDER || 'deepseek',
    models: {
      primary:  process.env.PRIMARY_MODEL   || 'deepseek-chat',
      fallback: process.env.FALLBACK_MODEL  || 'gpt-4o-mini',
      embed:    process.env.EMBED_MODEL     || 'text-embedding-3-small',
    },
    keys: {
      deepseek: process.env.DEEPSEEK_API_KEY,
      openai:   process.env.OPENAI_API_KEY,
    },
    limits: {
      maxTokens:     Number(process.env.MAX_TOKENS)     || 4096,
      maxRetries:    Number(process.env.MAX_RETRIES)    || 3,
      timeoutMs:     Number(process.env.TIMEOUT_MS)     || 30000,
    },
  },
  database: {
    url:      process.env.DATABASE_URL || 'postgresql://localhost:5432/aiapp',
    poolMin:  Number(process.env.DB_POOL_MIN)  || 2,
    poolMax:  Number(process.env.DB_POOL_MAX)  || 10,
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  chroma: {
    url: process.env.CHROMA_URL || 'http://localhost:8000',
  },
  cache: {
    ttl:       Number(process.env.CACHE_TTL)       || 1800000,  // 30 分钟
    maxSize:   Number(process.env.CACHE_MAX_SIZE)  || 1000,
  },
  rateLimit: {
    rpm:       Number(process.env.RATE_LIMIT_RPM)  || 20,
    rph:       Number(process.env.RATE_LIMIT_RPH)  || 200,
  },
  security: {
    jwtSecret:       process.env.JWT_SECRET || 'change-this-in-production',
    skipSafetyCheck: process.env.SKIP_SAFETY_CHECK === 'true',
  },
}

// 启动时校验必填配置
export function validateConfig() {
  const required = ['DEEPSEEK_API_KEY']
  const missing = required.filter(key => !process.env[key])
  if (missing.length) {
    throw new Error(`缺少必填环境变量：${missing.join(', ')}`)
  }
}
