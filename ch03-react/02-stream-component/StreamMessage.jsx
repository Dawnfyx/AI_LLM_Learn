// 02-stream-component/StreamMessage.jsx
// 流式消息组件：支持 Markdown 渲染、代码高亮、复制代码
import { useState, useEffect, useRef } from 'react'

// ── 简易 Markdown 解析（不引入第三方库）──────────────────────
function parseMarkdown(text) {
  return text
    // 代码块（多行）
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
      `<pre data-lang="${lang}"><code>${escapeHtml(code.trim())}</code></pre>`
    )
    // 行内代码
    .replace(/`([^`]+)`/g, (_, c) => `<code style="background:#f3f4f6;padding:2px 6px;border-radius:3px;font-size:0.9em">${escapeHtml(c)}</code>`)
    // 粗体
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // 斜体
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // 标题 h3
    .replace(/^### (.+)$/gm, '<h3 style="margin:12px 0 6px;font-size:1em">$1</h3>')
    // 标题 h2
    .replace(/^## (.+)$/gm, '<h2 style="margin:16px 0 8px;font-size:1.1em">$1</h2>')
    // 无序列表
    .replace(/^[-*] (.+)$/gm, '<li style="margin:4px 0">$1</li>')
    // 换行
    .replace(/\n\n/g, '</p><p style="margin:8px 0">')
    .replace(/\n/g, '<br>')
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── 代码块组件（带复制按钮）────────────────────────────────
function CodeBlock({ code, lang }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div style={{ position: 'relative', margin: '12px 0' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: '#1e1e1e', color: '#9ca3af', padding: '6px 12px',
        borderRadius: '6px 6px 0 0', fontSize: 12,
      }}>
        <span>{lang || 'code'}</span>
        <button
          onClick={copy}
          style={{
            background: copied ? '#065f46' : '#374151',
            color: copied ? '#6ee7b7' : '#9ca3af',
            border: 'none', borderRadius: 4, padding: '2px 10px',
            cursor: 'pointer', fontSize: 11,
          }}
        >
          {copied ? '✓ 已复制' : '复制'}
        </button>
      </div>
      <pre style={{
        margin: 0, background: '#1e1e1e', color: '#d4d4d4',
        padding: '12px 16px', borderRadius: '0 0 6px 6px',
        overflowX: 'auto', fontSize: 13, lineHeight: 1.6,
      }}>
        <code>{code}</code>
      </pre>
    </div>
  )
}

// ── 主组件：流式消息渲染 ─────────────────────────────────────
export function StreamMessage({ content, isStreaming = false }) {
  const [blocks, setBlocks] = useState([])

  // 把内容拆成文本块和代码块
  useEffect(() => {
    const parts = []
    const regex = /```(\w*)\n([\s\S]*?)```/g
    let lastIndex = 0
    let match

    while ((match = regex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: 'text', content: content.slice(lastIndex, match.index) })
      }
      parts.push({ type: 'code', lang: match[1], content: match[2].trim() })
      lastIndex = regex.lastIndex
    }

    if (lastIndex < content.length) {
      parts.push({ type: 'text', content: content.slice(lastIndex) })
    }

    setBlocks(parts)
  }, [content])

  return (
    <div style={{ fontSize: 14, lineHeight: 1.75, color: '#374151' }}>
      {blocks.map((block, i) => {
        if (block.type === 'code') {
          return <CodeBlock key={i} code={block.content} lang={block.lang} />
        }

        return (
          <div
            key={i}
            dangerouslySetInnerHTML={{
              __html: parseMarkdown(block.content),
            }}
          />
        )
      })}

      {/* 流式输出时显示光标 */}
      {isStreaming && blocks.length === 0 && (
        <span style={{
          display: 'inline-block', width: 2, height: '1em',
          background: '#374151', verticalAlign: 'text-bottom',
          animation: 'blink 0.7s infinite',
        }} />
      )}
      <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>
    </div>
  )
}

// ── 使用示例 ─────────────────────────────────────────────────
export function StreamMessageDemo() {
  const [content, setContent] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)

  const demoContent = `## Vue3 和 React 的对比

**响应式系统**

Vue3 使用 \`Proxy\` 实现响应式，React 依赖不可变数据和 \`useState\`。

\`\`\`js
// Vue3
const count = ref(0)
count.value++  // 直接修改，自动触发更新

// React
const [count, setCount] = useState(0)
setCount(count + 1)  // 必须通过 setter
\`\`\`

两种方式各有优劣，Vue3 写起来更简洁，React 的数据流更可预测。`

  function simulate() {
    setContent('')
    setIsStreaming(true)
    let i = 0

    const timer = setInterval(() => {
      i += 3
      setContent(demoContent.slice(0, i))
      if (i >= demoContent.length) {
        clearInterval(timer)
        setIsStreaming(false)
      }
    }, 30)
  }

  return (
    <div style={{ maxWidth: 700, margin: '40px auto', padding: '0 16px' }}>
      <button
        onClick={simulate}
        style={{
          padding: '8px 20px', background: '#4f46e5', color: '#fff',
          border: 'none', borderRadius: 6, cursor: 'pointer', marginBottom: 20,
        }}
      >
        模拟流式输出
      </button>
      <div style={{
        padding: 20, border: '1px solid #e5e7eb',
        borderRadius: 12, background: '#fff', minHeight: 100,
      }}>
        <StreamMessage content={content} isStreaming={isStreaming} />
      </div>
    </div>
  )
}
