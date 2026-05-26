// 02-mcp-server-tools/server-http.js
// HTTP + SSE 传输方式的 MCP Server
// 适合远程部署、多客户端连接场景
// 运行：node server-http.js，监听 3001 端口
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import express from 'express'
import { z } from 'zod'

const app = express()
app.use(express.json())

const server = new McpServer({
  name: 'frontend-dev-tools',
  version: '1.0.0',
})

// ── 工具集：前端开发辅助工具 ─────────────────────────────────

// 工具1：npm 包信息查询（模拟）
server.tool(
  'get_npm_info',
  '查询 npm 包的基本信息：版本、下载量、依赖数量',
  {
    packageName: z.string().describe('npm 包名，如 vue、react、lodash'),
  },
  async ({ packageName }) => {
    // 模拟数据，实际可调 registry.npmjs.org API
    const packages = {
      'vue': { version: '3.4.21', weeklyDownloads: '4,200,000', dependencies: 0, size: '22.5kb (gzip)', license: 'MIT' },
      'react': { version: '18.2.0', weeklyDownloads: '28,000,000', dependencies: 3, size: '6.4kb (gzip)', license: 'MIT' },
      'vite': { version: '5.2.0', weeklyDownloads: '8,500,000', dependencies: 20, size: '567kb', license: 'MIT' },
      'pinia': { version: '2.1.7', weeklyDownloads: '2,100,000', dependencies: 1, size: '1.8kb (gzip)', license: 'MIT' },
      'axios': { version: '1.6.8', weeklyDownloads: '56,000,000', dependencies: 3, size: '13.1kb (gzip)', license: 'MIT' },
    }

    const info = packages[packageName]
    if (!info) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `未找到包 ${packageName} 的信息` }) }],
      }
    }

    return {
      content: [{ type: 'text', text: JSON.stringify({ packageName, ...info }, null, 2) }],
    }
  }
)

// 工具2：CSS 属性查询
server.tool(
  'css_property_info',
  '查询 CSS 属性的浏览器兼容性、语法和使用示例',
  {
    property: z.string().describe('CSS 属性名，如 flex、grid、container'),
  },
  async ({ property }) => {
    const cssDb = {
      'flex': {
        fullName: 'Flexible Box Layout',
        support: 'Chrome 29+, Firefox 28+, Safari 9+',
        syntax: 'display: flex',
        keyProps: ['flex-direction', 'justify-content', 'align-items', 'flex-wrap'],
        example: '.container { display: flex; justify-content: space-between; align-items: center; }',
      },
      'grid': {
        fullName: 'CSS Grid Layout',
        support: 'Chrome 57+, Firefox 52+, Safari 10.1+',
        syntax: 'display: grid',
        keyProps: ['grid-template-columns', 'grid-template-rows', 'gap', 'grid-area'],
        example: '.container { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }',
      },
      'container': {
        fullName: 'Container Queries',
        support: 'Chrome 105+, Firefox 110+, Safari 16+',
        syntax: 'container-type: inline-size',
        keyProps: ['container-name', 'container-type', '@container'],
        example: '.card { container-type: inline-size; }\n@container (min-width: 400px) { .card-title { font-size: 1.2rem; } }',
      },
    }

    const info = cssDb[property.toLowerCase()]
    if (!info) {
      return {
        content: [{ type: 'text', text: `CSS 属性 ${property} 暂无数据，请查阅 MDN 文档` }],
      }
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(info, null, 2) }],
    }
  }
)

// 工具3：代码复杂度分析
server.tool(
  'analyze_complexity',
  '分析 JavaScript/TypeScript 函数的圈复杂度，给出优化建议',
  {
    code: z.string().describe('要分析的函数代码'),
    functionName: z.string().optional().describe('函数名称（可选，用于报告标题）'),
  },
  async ({ code, functionName = 'anonymous' }) => {
    // 简化的圈复杂度计算：统计分支结构数
    const branchPatterns = [
      /\bif\b/g,
      /\belse if\b/g,
      /\bfor\b/g,
      /\bwhile\b/g,
      /\bcase\b/g,
      /\?\s*.*\s*:/g,  // 三元运算符
      /&&/g,
      /\|\|/g,
    ]

    let complexity = 1 // 基础复杂度
    for (const pattern of branchPatterns) {
      const matches = code.match(pattern)
      if (matches) complexity += matches.length
    }

    const lines = code.split('\n').length
    const level = complexity <= 5 ? 'low' : complexity <= 10 ? 'medium' : 'high'

    const suggestions = []
    if (complexity > 10) {
      suggestions.push('函数复杂度过高，建议拆分成多个小函数')
      suggestions.push('使用提前返回（early return）减少嵌套层级')
    }
    if (complexity > 5) {
      suggestions.push('考虑使用策略模式替代多个 if/else 分支')
    }
    if (lines > 50) {
      suggestions.push(`函数行数 ${lines} 行，建议控制在 30 行以内`)
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          functionName,
          complexity,
          level,
          lines,
          rating: level === 'low' ? '✓ 良好' : level === 'medium' ? '⚠ 一般' : '✗ 需要重构',
          suggestions: suggestions.length ? suggestions : ['代码结构良好，无需优化'],
        }, null, 2),
      }],
    }
  }
)

// ── 提示词模板 ───────────────────────────────────────────────
// Prompts 是 MCP 的第三种原语：预定义的提示词模板
server.prompt(
  'code-review-template',
  '代码审查提示词模板',
  {
    code: z.string().describe('要审查的代码'),
    focus: z.string().optional().describe('审查重点，如：性能、安全性、可读性'),
  },
  async ({ code, focus }) => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `请对以下代码进行审查${focus ? `，重点关注：${focus}` : ''}：

\`\`\`javascript
${code}
\`\`\`

请从以下维度分析：
1. 代码质量和可读性
2. 潜在的 Bug 或错误
3. 性能问题
4. 安全性（如有）
5. 具体的改进建议（附示例代码）`,
      },
    }],
  })
)

// ── HTTP + SSE 传输层 ────────────────────────────────────────
const transports = new Map()  // sessionId → transport

// SSE 连接端点
app.get('/sse', async (req, res) => {
  const transport = new SSEServerTransport('/messages', res)
  transports.set(transport.sessionId, transport)

  res.on('close', () => {
    transports.delete(transport.sessionId)
    console.log(`客户端断开：${transport.sessionId}`)
  })

  console.log(`新客户端连接：${transport.sessionId}`)
  await server.connect(transport)
})

// 消息接收端点
app.post('/messages', async (req, res) => {
  const sessionId = req.query.sessionId
  const transport = transports.get(sessionId)

  if (!transport) {
    return res.status(404).json({ error: 'Session not found' })
  }

  await transport.handlePostMessage(req, res)
})

// 健康检查
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    server: 'frontend-dev-tools',
    connections: transports.size,
    tools: ['get_npm_info', 'css_property_info', 'analyze_complexity'],
  })
})

app.listen(3001, () => {
  console.log('MCP Server (HTTP+SSE) 已启动：http://localhost:3001')
  console.log('SSE 端点：http://localhost:3001/sse')
})
