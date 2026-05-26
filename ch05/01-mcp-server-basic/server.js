// 01-mcp-server-basic/server.js
// 最简单的 MCP Server：用 stdio 传输，暴露两个工具
// 运行：node server.js
// 协议格式：JSON-RPC 2.0，通过 stdin/stdout 通信
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

// 创建 MCP Server 实例
const server = new McpServer({
  name: 'frontend-tools',       // Server 名称，客户端显示用
  version: '1.0.0',
})

// ── 工具1：代码格式检查 ──────────────────────────────────────
server.tool(
  'check_code_style',
  '检查前端代码风格问题，返回发现的问题列表和修复建议',
  {
    code: z.string().describe('要检查的代码片段'),
    lang: z.enum(['javascript', 'typescript', 'vue', 'react'])
      .default('javascript')
      .describe('代码语言类型'),
  },
  async ({ code, lang }) => {
    const issues = []

    // 简单的规则检测（实际项目里接 ESLint API）
    if (code.includes('var ')) {
      issues.push({ rule: 'no-var', severity: 'error', message: '使用 let/const 替代 var', line: findLine(code, 'var ') })
    }
    if (code.includes('console.log')) {
      issues.push({ rule: 'no-console', severity: 'warning', message: '生产代码不应包含 console.log', line: findLine(code, 'console.log') })
    }
    if (code.match(/function\s+\w+\s*\(/)) {
      issues.push({ rule: 'prefer-arrow', severity: 'info', message: '建议使用箭头函数', line: 1 })
    }
    if ((lang === 'vue' || lang === 'react') && !code.includes('key=') && code.includes('v-for\|.map(')) {
      issues.push({ rule: 'require-key', severity: 'error', message: '列表渲染必须添加 key 属性' })
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          lang,
          issueCount: issues.length,
          issues,
          summary: issues.length === 0 ? '✓ 代码风格检查通过' : `发现 ${issues.length} 个问题`,
        }, null, 2),
      }],
    }
  }
)

// ── 工具2：生成组件模板 ──────────────────────────────────────
server.tool(
  'generate_component',
  '生成 Vue3 或 React 组件的基础模板代码',
  {
    name: z.string().describe('组件名称，如 UserCard'),
    framework: z.enum(['vue3', 'react']).describe('前端框架'),
    features: z.array(z.enum(['props', 'emits', 'slots', 'composable', 'typescript']))
      .default([])
      .describe('需要包含的特性'),
  },
  async ({ name, framework, features }) => {
    let template = ''

    if (framework === 'vue3') {
      const hasProps = features.includes('props')
      const hasEmits = features.includes('emits')
      const hasTs = features.includes('typescript')

      template = `<template>
  <div class="${toKebab(name)}">
    <slot />
  </div>
</template>

<script setup${hasTs ? ' lang="ts"' : ''}>
${hasProps ? `const props = defineProps${hasTs ? '<{\n  title: string\n  count?: number\n}>' : ''}({
  title: { type: String, required: true },
  count: { type: Number, default: 0 },
})` : ''}
${hasEmits ? `const emit = defineEmits${hasTs ? '<{\n  change: [value: string]\n  close: []\n}>' : ''}(['change', 'close'])` : ''}
</script>

<style scoped>
.${toKebab(name)} {
  /* 组件样式 */
}
</style>`
    } else {
      const hasTs = features.includes('typescript')
      template = `import { useState } from 'react'
${hasTs ? `\ninterface ${name}Props {\n  title: string\n  count?: number\n}\n` : ''}
export default function ${name}(${hasTs ? `{ title, count = 0 }: ${name}Props` : '{ title, count = 0 }'}) {
  const [value, setValue] = useState('')

  return (
    <div className="${toKebab(name)}">
      <h2>{title}</h2>
      <p>Count: {count}</p>
    </div>
  )
}`
    }

    return {
      content: [{ type: 'text', text: template }],
    }
  }
)

// ── 资源：暴露文档内容 ───────────────────────────────────────
// Resources 是 MCP 的另一种原语，用于暴露数据（只读）
server.resource(
  'vue3-cheatsheet',
  'file:///docs/vue3-cheatsheet',
  'Vue3 常用 API 速查表',
  'text/markdown',
  async () => ({
    contents: [{
      uri: 'file:///docs/vue3-cheatsheet',
      mimeType: 'text/markdown',
      text: `# Vue3 API 速查

## 响应式
- \`ref(value)\` — 基础响应式，通过 .value 访问
- \`reactive(obj)\` — 对象响应式，直接访问属性
- \`computed(() => ...)\` — 计算属性，自动缓存
- \`watch(source, callback)\` — 监听变化
- \`watchEffect(fn)\` — 自动追踪依赖

## 生命周期
- \`onMounted(fn)\` — 挂载后
- \`onUnmounted(fn)\` — 卸载前（清理定时器/事件）
- \`onBeforeUpdate(fn)\` — 更新前

## 组件通信
- \`defineProps()\` — 接收父组件数据
- \`defineEmits()\` — 向父组件发送事件
- \`defineExpose()\` — 暴露给父组件访问
- \`provide/inject\` — 跨层级数据传递
`,
    }],
  })
)

// 工具函数
function findLine(code, pattern) {
  const lines = code.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(pattern)) return i + 1
  }
  return 1
}

function toKebab(str) {
  return str.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '')
}

// 启动 Server（stdio 传输）
const transport = new StdioServerTransport()
await server.connect(transport)
console.error('MCP Server 已启动（stdio 模式）')
