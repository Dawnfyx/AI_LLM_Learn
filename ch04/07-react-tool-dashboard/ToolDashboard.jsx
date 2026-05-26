// 07-react-tool-dashboard/ToolDashboard.jsx
// React 版本的工具调用可视化面板
import { useState, useRef, useEffect, useCallback } from 'react'

const API = 'http://localhost:3000'

function formatTime() {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatJSON(str) {
  try { return JSON.stringify(JSON.parse(str), null, 2) }
  catch { return String(str).slice(0, 300) }
}

// ── 工具日志条目组件 ──────────────────────────────────────────
function ToolLogItem({ log }) {
  const isStart = log.type === 'tool_start'

  return (
    <div style={{
      border: `1px solid ${isStart ? '#bfdbfe' : '#bbf7d0'}`,
      borderRadius: 8, overflow: 'hidden', fontSize: 12, marginBottom: 8,
    }}>
      {/* 头部 */}
      <div style={{
        padding: '7px 12px',
        background: isStart ? '#eff6ff' : '#f0fdf4',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 14 }}>{isStart ? '⚡' : '✓'}</span>
        <span style={{ flex: 1, fontWeight: 600, color: '#374151' }}>
          {isStart ? '调用' : '返回'}: {log.tool}
        </span>
        <span style={{ color: '#9ca3af', fontSize: 11 }}>{log.time}</span>
      </div>

      {/* 参数 / 结果 */}
      {((isStart && log.args) || (!isStart && log.result)) && (
        <div style={{ padding: '10px 12px', background: '#fff' }}>
          <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 4 }}>
            {isStart ? '参数：' : '返回值：'}
          </div>
          <pre style={{
            margin: 0, fontSize: 11, color: '#374151',
            whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          }}>
            {isStart
              ? JSON.stringify(log.args, null, 2)
              : formatJSON(log.result)
            }
          </pre>
        </div>
      )}
    </div>
  )
}

// ── 消息气泡 ──────────────────────────────────────────────────
function MessageBubble({ message, isStreaming }) {
  const isUser = message.role === 'user'

  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 10,
    }}>
      <div style={{
        maxWidth: '80%', padding: '9px 13px', borderRadius: 10, fontSize: 14, lineHeight: 1.6,
        background: isUser ? '#4f46e5' : '#f3f4f6',
        color: isUser ? '#fff' : '#374151',
        wordBreak: 'break-word',
      }}>
        {message.content}
        {isStreaming && (
          <>
            <span style={{
              display: 'inline-block', width: 2, height: '1em',
              background: '#374151', animation: 'blink .7s infinite',
              verticalAlign: 'text-bottom', marginLeft: 1,
            }} />
            <style>{`@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}`}</style>
          </>
        )}
      </div>
    </div>
  )
}

// ── 主组件 ────────────────────────────────────────────────────
export default function ToolDashboard() {
  const [input, setInput]           = useState('')
  const [messages, setMessages]     = useState([])
  const [toolLogs, setToolLogs]     = useState([])
  const [loading, setLoading]       = useState(false)
  const [streaming, setStreaming]   = useState(false)
  const [streamContent, setStreamContent] = useState('')

  const msgBottomRef = useRef(null)
  const logBottomRef = useRef(null)
  const idRef        = useRef(0)
  const nextId       = () => ++idRef.current

  useEffect(() => { msgBottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, streamContent])
  useEffect(() => { logBottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [toolLogs])

  const send = useCallback(async () => {
    if (!input.trim() || loading) return
    const msg = input.trim()
    setInput('')
    setLoading(true)

    setMessages(prev => [...prev, { id: nextId(), role: 'user', content: msg }])
    setStreaming(true)
    setStreamContent('')

    try {
      const res = await fetch(`${API}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      })

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer    = ''
      let full      = ''
      let lastEvent = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            lastEvent = line.slice(7).trim()
            continue
          }

          if (!line.startsWith('data: ')) continue

          try {
            const data = JSON.parse(line.slice(6))

            if (lastEvent === 'tool_start') {
              setToolLogs(prev => [...prev, {
                id: nextId(), type: 'tool_start',
                tool: data.tool, args: data.args, time: formatTime(),
              }])
            }

            if (lastEvent === 'tool_end') {
              setToolLogs(prev => [...prev, {
                id: nextId(), type: 'tool_end',
                tool: data.tool, result: data.result, time: formatTime(),
              }])
            }

            if (lastEvent === 'token' && data.token) {
              full += data.token
              setStreamContent(full)
            }

            if (lastEvent === 'done') {
              setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: full }])
              setStreaming(false)
              setStreamContent('')
            }
          } catch {}
        }
      }
    } catch (err) {
      setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: `错误：${err.message}` }])
    } finally {
      setLoading(false)
      setStreaming(false)
    }
  }, [input, loading])

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', height: '100vh', fontFamily: 'sans-serif' }}>

      {/* 左：对话区 */}
      <div style={{ display: 'flex', flexDirection: 'column', borderRight: '1px solid #e5e7eb' }}>
        <div style={{ padding: '14px 16px', fontWeight: 600, fontSize: 14, borderBottom: '1px solid #e5e7eb' }}>
          对话
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {messages.length === 0 && (
            <div style={{ color: '#9ca3af', fontSize: 13, textAlign: 'center', marginTop: 30 }}>
              试试：北京今天天气？或查 vue 最新版本
            </div>
          )}
          {messages.map(m => <MessageBubble key={m.id} message={m} />)}
          {streaming && (
            <MessageBubble message={{ role: 'assistant', content: streamContent }} isStreaming />
          )}
          <div ref={msgBottomRef} />
        </div>

        <div style={{ padding: '12px 16px', borderTop: '1px solid #e5e7eb', display: 'flex', gap: 8 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && send()}
            placeholder="输入问题..."
            disabled={loading}
            style={{
              flex: 1, padding: '8px 12px',
              border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 14,
            }}
          />
          <button
            onClick={send}
            disabled={!input.trim() || loading}
            style={{
              padding: '8px 16px', background: '#4f46e5', color: '#fff',
              border: 'none', borderRadius: 6, cursor: 'pointer',
              opacity: (!input.trim() || loading) ? 0.5 : 1,
            }}
          >
            {loading ? '...' : '发送'}
          </button>
        </div>
      </div>

      {/* 右：工具调用日志 */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{
          padding: '14px 16px', fontWeight: 600, fontSize: 14,
          borderBottom: '1px solid #e5e7eb',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>工具调用过程</span>
          <span
            onClick={() => setToolLogs([])}
            style={{ fontSize: 12, color: '#9ca3af', cursor: 'pointer', fontWeight: 400 }}
          >
            清空
          </span>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {toolLogs.length === 0 && (
            <div style={{ color: '#9ca3af', fontSize: 13, textAlign: 'center', marginTop: 30 }}>
              工具调用记录将显示在这里
            </div>
          )}
          {toolLogs.map(log => <ToolLogItem key={log.id} log={log} />)}
          <div ref={logBottomRef} />
        </div>
      </div>
    </div>
  )
}
