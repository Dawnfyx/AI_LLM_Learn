// 06-react-tool-dashboard/ToolDashboard.jsx
// React 版工具调用可视化面板
import { useState, useRef, useEffect, useCallback } from 'react'

const API = 'http://localhost:3000'

// SSE 事件解析器：正确处理 event + data 两行组成的 SSE 消息
function parseSseStream(text) {
  const events = []
  const blocks = text.split('\n\n').filter(Boolean)

  for (const block of blocks) {
    const lines = block.split('\n')
    let event = 'message'
    let data = ''

    for (const line of lines) {
      if (line.startsWith('event: ')) event = line.slice(7).trim()
      if (line.startsWith('data: ')) data = line.slice(6)
    }

    if (data) {
      try { events.push({ event, data: JSON.parse(data) }) }
      catch { events.push({ event, data }) }
    }
  }

  return events
}

// 工具状态颜色配置
const TOOL_STATUS = {
  running: { border: '#3b82f6', bg: '#eff6ff', dot: '#3b82f6', label: '执行中', labelColor: '#1d4ed8' },
  done:    { border: '#22c55e', bg: '#f0fdf4', dot: '#22c55e', label: '完成',   labelColor: '#15803d' },
  error:   { border: '#ef4444', bg: '#fef2f2', dot: '#ef4444', label: '失败',   labelColor: '#b91c1c' },
}

function ToolCard({ toolCall }) {
  const s = TOOL_STATUS[toolCall.status] || TOOL_STATUS.running
  const [argsOpen, setArgsOpen] = useState(true)
  const [resultOpen, setResultOpen] = useState(true)

  function formatJSON(data) {
    try {
      const obj = typeof data === 'string' ? JSON.parse(data) : data
      return JSON.stringify(obj, null, 2)
    } catch { return String(data) }
  }

  return (
    <div style={{
      background: '#fff',
      border: `1px solid ${s.border}`,
      borderRadius: 10,
      padding: 14,
      boxShadow: toolCall.status === 'running' ? `0 0 0 3px ${s.border}20` : 'none',
      transition: 'all 0.2s',
    }}>
      {/* 头部 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: s.dot, flexShrink: 0,
          animation: toolCall.status === 'running' ? 'pulse 1s infinite' : 'none',
        }} />
        <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600, color: '#1f2937', flex: 1 }}>
          {toolCall.toolName}
        </span>
        {toolCall.duration && (
          <span style={{ fontSize: 11, color: '#9ca3af' }}>{toolCall.duration}ms</span>
        )}
        <span style={{
          fontSize: 11, padding: '2px 8px', borderRadius: 10,
          background: s.bg, color: s.labelColor,
        }}>
          {s.label}
        </span>
      </div>

      {/* 入参 */}
      {toolCall.args && (
        <div style={{ marginTop: 8 }}>
          <button
            onClick={() => setArgsOpen(v => !v)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600, padding: '2px 0', marginBottom: 4 }}
          >
            {argsOpen ? '▾' : '▸'} 入参
          </button>
          {argsOpen && (
            <pre style={{
              background: '#f8f9fa', border: '1px solid #e5e7eb', borderRadius: 6,
              padding: '8px 10px', fontSize: 11, lineHeight: 1.6, margin: 0,
              fontFamily: 'monospace', color: '#374151', overflowX: 'auto', maxHeight: 120, overflowY: 'auto',
            }}>
              {formatJSON(toolCall.args)}
            </pre>
          )}
        </div>
      )}

      {/* 出参 */}
      {toolCall.result && (
        <div style={{ marginTop: 8 }}>
          <button
            onClick={() => setResultOpen(v => !v)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600, padding: '2px 0', marginBottom: 4 }}
          >
            {resultOpen ? '▾' : '▸'} 出参
          </button>
          {resultOpen && (
            <pre style={{
              background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6,
              padding: '8px 10px', fontSize: 11, lineHeight: 1.6, margin: 0,
              fontFamily: 'monospace', color: '#374151', overflowX: 'auto', maxHeight: 150, overflowY: 'auto',
            }}>
              {formatJSON(toolCall.result)}
            </pre>
          )}
        </div>
      )}

      {/* 进度条（执行中） */}
      {toolCall.status === 'running' && (
        <div style={{ height: 3, background: '#e5e7eb', borderRadius: 2, overflow: 'hidden', marginTop: 10 }}>
          <div style={{ height: '100%', width: '40%', background: '#3b82f6', borderRadius: 2, animation: 'slide 1.2s ease-in-out infinite' }} />
        </div>
      )}

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.6;transform:scale(1.3)} }
        @keyframes slide { 0%{transform:translateX(-100%)} 100%{transform:translateX(350%)} }
      `}</style>
    </div>
  )
}

export default function ToolDashboard() {
  const [input, setInput]               = useState('')
  const [messages, setMessages]         = useState([])
  const [toolCalls, setToolCalls]       = useState([])
  const [streaming, setStreaming]       = useState(false)
  const [streamContent, setStreamContent] = useState('')
  const [loading, setLoading]           = useState(false)
  const bottomRef                       = useRef(null)
  const activeToolsRef                  = useRef({})
  let msgId = useRef(0)
  let toolId = useRef(0)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, streamContent])

  const send = useCallback(async () => {
    if (!input.trim() || loading) return

    const userMsg = input.trim()
    setInput('')
    setLoading(true)
    setToolCalls([])
    setStreamContent('')
    activeToolsRef.current = {}

    setMessages(prev => [...prev, { id: ++msgId.current, role: 'user', content: userMsg }])

    try {
      const res = await fetch(`${API}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg }),
      })

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer    = ''
      let fullReply = ''

      setStreaming(true)

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // 找完整的 SSE 块（以 \n\n 分隔）
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''

        for (const part of parts) {
          if (!part.trim()) continue

          const lines = part.split('\n')
          let eventType = 'message'
          let dataStr = ''

          for (const line of lines) {
            if (line.startsWith('event: ')) eventType = line.slice(7)
            if (line.startsWith('data: '))  dataStr = line.slice(6)
          }

          if (!dataStr) continue
          let data
          try { data = JSON.parse(dataStr) } catch { continue }

          if (eventType === 'tool_start') {
            const tc = {
              id: ++toolId.current,
              toolName: data.toolName,
              args: data.args,
              status: 'running',
              startTime: Date.now(),
              result: null,
              duration: null,
            }
            activeToolsRef.current[data.toolName] = tc
            setToolCalls(prev => [...prev, tc])
          }

          if (eventType === 'tool_end') {
            const duration = Date.now() - (activeToolsRef.current[data.toolName]?.startTime ?? Date.now())
            setToolCalls(prev =>
              prev.map(tc =>
                tc.toolName === data.toolName && tc.status === 'running'
                  ? { ...tc, result: data.result, status: 'done', duration }
                  : tc
              )
            )
          }

          if (eventType === 'token') {
            fullReply += data.token
            setStreamContent(fullReply)
          }

          if (eventType === 'done') {
            setMessages(prev => [...prev, { id: ++msgId.current, role: 'assistant', content: fullReply }])
            setStreaming(false)
            setStreamContent('')
          }
        }
      }
    } catch (err) {
      setMessages(prev => [...prev, { id: ++msgId.current, role: 'assistant', content: `错误：${err.message}` }])
      setStreaming(false)
    } finally {
      setLoading(false)
    }
  }, [input, loading])

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: '-apple-system, sans-serif', background: '#f8f9fa' }}>
      {/* 左：对话 */}
      <div style={{ width: 420, display: 'flex', flexDirection: 'column', borderRight: '1px solid #e5e7eb', background: '#fff' }}>
        <div style={{ padding: '14px 16px', fontWeight: 600, fontSize: 14, borderBottom: '1px solid #e5e7eb' }}>
          💬 对话
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: 13, marginTop: 40 }}>
              试试问：「帮我找手机配件，预算 100 元以内」
            </div>
          )}

          {messages.map(m => (
            <div key={m.id} style={{ display: 'flex', flexDirection: m.role === 'user' ? 'row-reverse' : 'row', gap: 10 }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                background: m.role === 'user' ? '#059669' : '#4f46e5',
                color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600,
              }}>
                {m.role === 'user' ? '我' : 'AI'}
              </div>
              <div style={{
                maxWidth: '80%', padding: '9px 13px', borderRadius: 12,
                background: m.role === 'user' ? '#4f46e5' : '#f3f4f6',
                color: m.role === 'user' ? '#fff' : '#374151',
                fontSize: 13, lineHeight: 1.7,
              }}>
                {m.content}
              </div>
            </div>
          ))}

          {streaming && (
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#4f46e5', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>AI</div>
              <div style={{ maxWidth: '80%', padding: '9px 13px', borderRadius: 12, background: '#f3f4f6', fontSize: 13, lineHeight: 1.7 }}>
                {streamContent}
                <span style={{ display: 'inline-block', width: 2, height: '1em', background: '#374151', verticalAlign: 'text-bottom', animation: 'blink .7s infinite' }} />
                <style>{`@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}`}</style>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        <div style={{ padding: 14, borderTop: '1px solid #e5e7eb', display: 'flex', gap: 8 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && send()}
            placeholder="输入问题..."
            disabled={loading}
            style={{ flex: 1, padding: '9px 13px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, outline: 'none' }}
          />
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            style={{ padding: '9px 18px', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, opacity: (loading || !input.trim()) ? .45 : 1 }}
          >
            {loading ? '...' : '发送'}
          </button>
        </div>
      </div>

      {/* 右：工具调用 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 16px', fontWeight: 600, fontSize: 14, borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 8 }}>
          🔧 工具调用过程
          {toolCalls.length > 0 && (
            <span style={{ fontSize: 11, background: '#ede9fe', color: '#6d28d9', padding: '2px 8px', borderRadius: 10, fontWeight: 400 }}>
              {toolCalls.length} 次调用
            </span>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {toolCalls.length === 0 && !loading && (
            <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: 13, marginTop: 40 }}>
              发送消息后，这里会实时显示工具调用的详细过程
            </div>
          )}
          {toolCalls.map(tc => <ToolCard key={tc.id} toolCall={tc} />)}
        </div>
      </div>
    </div>
  )
}
