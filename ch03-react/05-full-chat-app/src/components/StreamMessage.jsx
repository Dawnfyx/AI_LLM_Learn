// 05-full-chat-app/src/components/StreamMessage.jsx
// Markdown 渲染 + 代码块复制
import { useState, useEffect } from 'react'

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function parseInlineMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code style="background:#f3f4f6;padding:1px 5px;border-radius:3px;font-size:0.88em;font-family:monospace">$1</code>')
}

function CodeBlock({ lang, code }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  return (
    <div style={{ borderRadius: 8, overflow: 'hidden', margin: '10px 0', border: '1px solid #2d2d2d' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: '#2d2d2d', padding: '6px 14px',
      }}>
        <span style={{ fontSize: 12, color: '#9ca3af', fontFamily: 'monospace' }}>
          {lang || 'plaintext'}
        </span>
        <button
          onClick={copy}
          style={{
            fontSize: 11, padding: '2px 10px', borderRadius: 4, cursor: 'pointer',
            background: copied ? '#065f46' : '#3f3f3f',
            color: copied ? '#6ee7b7' : '#d1d5db',
            border: 'none',
          }}
        >
          {copied ? '✓ 已复制' : '复制'}
        </button>
      </div>
      <pre style={{
        margin: 0, background: '#1e1e1e', color: '#d4d4d4',
        padding: '14px 16px', overflowX: 'auto',
        fontSize: 13, lineHeight: 1.65, fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      }}>
        <code dangerouslySetInnerHTML={{ __html: escapeHtml(code) }} />
      </pre>
    </div>
  )
}

export function StreamMessage({ content, isStreaming }) {
  const [blocks, setBlocks] = useState([])

  useEffect(() => {
    if (!content) { setBlocks([]); return }

    const parts = []
    const regex = /```(\w*)\n?([\s\S]*?)```/g
    let last = 0
    let m

    while ((m = regex.exec(content)) !== null) {
      if (m.index > last) {
        parts.push({ type: 'text', content: content.slice(last, m.index) })
      }
      parts.push({ type: 'code', lang: m[1], content: m[2].trim() })
      last = regex.lastIndex
    }

    if (last < content.length) {
      parts.push({ type: 'text', content: content.slice(last) })
    }

    setBlocks(parts)
  }, [content])

  if (!content && !isStreaming) return null

  return (
    <div style={{ fontSize: 14, lineHeight: 1.75, color: 'inherit' }}>
      {blocks.map((block, i) => {
        if (block.type === 'code') {
          return <CodeBlock key={i} lang={block.lang} code={block.content} />
        }

        // 文本块：处理标题、列表、换行
        const lines = block.content.split('\n')
        return (
          <div key={i}>
            {lines.map((line, j) => {
              if (line.startsWith('## ')) {
                return <h2 key={j} style={{ fontSize: '1.05em', fontWeight: 600, margin: '14px 0 6px' }} dangerouslySetInnerHTML={{ __html: parseInlineMarkdown(line.slice(3)) }} />
              }
              if (line.startsWith('### ')) {
                return <h3 key={j} style={{ fontSize: '0.95em', fontWeight: 600, margin: '10px 0 4px' }} dangerouslySetInnerHTML={{ __html: parseInlineMarkdown(line.slice(4)) }} />
              }
              if (line.startsWith('- ') || line.startsWith('* ')) {
                return <div key={j} style={{ paddingLeft: 16, marginBottom: 3 }}>• <span dangerouslySetInnerHTML={{ __html: parseInlineMarkdown(line.slice(2)) }} /></div>
              }
              if (line.match(/^\d+\. /)) {
                return <div key={j} style={{ paddingLeft: 16, marginBottom: 3 }} dangerouslySetInnerHTML={{ __html: parseInlineMarkdown(line) }} />
              }
              if (line === '') return <div key={j} style={{ height: 8 }} />
              return <p key={j} style={{ margin: '4px 0' }} dangerouslySetInnerHTML={{ __html: parseInlineMarkdown(line) }} />
            })}
          </div>
        )
      })}

      {/* 流式光标 */}
      {isStreaming && (
        <>
          <span style={{
            display: 'inline-block', width: 2, height: '1em',
            background: 'currentColor', verticalAlign: 'text-bottom',
            animation: 'blink .7s infinite',
          }} />
          <style>{`@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}`}</style>
        </>
      )}
    </div>
  )
}
