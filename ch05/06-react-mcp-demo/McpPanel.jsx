// 06-react-mcp-demo/McpPanel.jsx
// React 版 MCP 工具管理面板
import { useState, useRef, useEffect } from 'react'
import { useMcpTools } from './useMcpTools'

const API = 'http://localhost:3000'

// 服务器状态指示灯
function ServerStatus({ servers }) {
  return (
    <div style={{ padding: '10px 16px', borderBottom: '1px solid #f3f4f6' }}>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9ca3af', marginBottom: 6 }}>
        MCP Servers
      </div>
      {servers.map(s => (
        <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: s.status === 'connected' ? '#22c55e' : '#ef4444' }} />
          <span style={{ fontSize: 12, color: '#374151', fontFamily: 'monospace' }}>{s.name}</span>
          <span style={{ fontSize: 10, color: '#9ca3af' }}>{s.status}</span>
        </div>
      ))}
    </div>
  )
}

// 工具列表项
function ToolItem({ tool, isSelected, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: '8px 16px',
        display: 'flex',
        gap: 8,
        cursor: 'pointer',
        background: isSelected ? '#ede9fe' : 'transparent',
        borderLeft: isSelected ? '3px solid #4f46e5' : '3px solid transparent',
        transition: 'all 0.15s',
      }}
    >
      <span style={{ fontSize: 13, flexShrink: 0 }}>🔧</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: '#374151', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {tool.displayName}
        </div>
        <div style={{ fontSize: 11, color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
          {tool.description.replace(`[${tool.server}] `, '').slice(0, 45)}...
        </div>
      </div>
    </div>
  )
}

// 聊天气泡
function ChatBubble({ message, isStreaming, streamContent }) {
  const isUser = message?.role === 'user'
  const content = isStreaming ? streamContent : message?.content

  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 8,
    }}>
      <div style={{
        maxWidth: '80%',
        padding: '8px 12px',
        borderRadius: isUser ? '12px 4px 12px 12px' : '4px 12px 12px 12px',
        background: isUser ? '#4f46e5' : '#f3f4f6',
        color: isUser ? '#fff' : '#374151',
        fontSize: 13,
        lineHeight: 1.65,
      }}>
        {content}
        {isStreaming && (
          <>
            <span style={{ display: 'inline-block', width: 2, height: '1em', background: 'currentColor', verticalAlign: 'text-bottom', animation: 'blink .7s infinite' }} />
            <style>{`@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}`}</style>
          </>
        )}
      </div>
    </div>
  )
}

export default function McpPanel() {
  const { tools, servers, toolsByServer, loading } = useMcpTools()
  const [selectedTool, setSelectedTool] = useState(null)
  const [messages, setMessages]         = useState([])
  const [chatInput, setChatInput]       = useState('')
  const [chatLoading, setChatLoading]   = useState(false)
  const [streaming, setStreaming]       = useState(false)
  const [streamContent, setStreamContent] = useState('')
  const [activeToolCalls, setActiveToolCalls] = useState([])
  const bottomRef = useRef(null)
  let msgId = useRef(0)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, streamContent])

  async function sendChat() {
    if (!chatInput.trim() || chatLoading) return

    const msg = chatInput.trim()
    setChatInput('')
    setChatLoading(true)
    setActiveToolCalls([])
    setMessages(prev => [...prev, { id: ++msgId.current, role: 'user', content: msg }])

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

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''

        for (const part of parts) {
          if (!part.trim()) continue
          const lines = part.split('\n')
          let event = '', dataStr = ''
          for (const line of lines) {
            if (line.startsWith('event: ')) event = line.slice(7)
            if (line.startsWith('data: '))  dataStr = line.slice(6)
          }
          if (!dataStr) continue
          try {
            const data = JSON.parse(dataStr)
            if (event === 'tool_start') {
              setActiveToolCalls(prev => [...prev, { name: data.toolName, status: 'running', args: data.args }])
            }
            if (event === 'tool_end') {
              setActiveToolCalls(prev =>
                prev.map(tc => tc.name === data.toolName && tc.status === 'running'
                  ? { ...tc, status: 'done', result: data.result }
                  : tc
                )
              )
            }
            if (event === 'token') {
              full += data.token
              setStreamContent(full)
            }
            if (event === 'done') {
              setMessages(prev => [...prev, { id: ++msgId.current, role: 'assistant', content: full }])
              setStreaming(false)
              setStreamContent('')
            }
          } catch {}
        }
      }
    } finally {
      setChatLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: '-apple-system, sans-serif' }}>
      {/* 左侧边栏 */}
      <div style={{ width: 260, borderRight: '1px solid #e5e7eb', background: '#f9fafb', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', fontWeight: 600, fontSize: 14, borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between' }}>
          MCP 工具库
          <span style={{ fontSize: 11, background: '#ede9fe', color: '#6d28d9', padding: '2px 8px', borderRadius: 10, fontWeight: 400 }}>
            {tools.length} 个
          </span>
        </div>

        {loading ? (
          <div style={{ padding: 16, color: '#9ca3af', fontSize: 13 }}>连接 MCP Server...</div>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <ServerStatus servers={servers} />

            {Object.entries(toolsByServer).map(([serverName, serverTools]) => (
              <div key={serverName} style={{ marginTop: 8 }}>
                <div style={{ padding: '4px 16px', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9ca3af', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{serverName}</span>
                  <span>{serverTools.length}</span>
                </div>
                {serverTools.map(t => (
                  <ToolItem
                    key={t.name}
                    tool={t}
                    isSelected={selectedTool?.name === t.name}
                    onClick={() => setSelectedTool(t)}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 右侧主内容 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* 工具调用状态栏 */}
        {activeToolCalls.length > 0 && (
          <div style={{ padding: '8px 16px', background: '#eff6ff', borderBottom: '1px solid #bfdbfe', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {activeToolCalls.map((tc, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '3px 10px', borderRadius: 12,
                background: tc.status === 'running' ? '#dbeafe' : '#dcfce7',
                fontSize: 12,
              }}>
                <div style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: tc.status === 'running' ? '#3b82f6' : '#22c55e',
                  animation: tc.status === 'running' ? 'pulse 1s infinite' : 'none',
                }} />
                <span style={{ fontFamily: 'monospace' }}>{tc.name}</span>
                <span style={{ color: tc.status === 'running' ? '#1d4ed8' : '#15803d' }}>
                  {tc.status === 'running' ? '执行中' : '完成'}
                </span>
              </div>
            ))}
            <style>{`@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.6;transform:scale(1.3)}}`}</style>
          </div>
        )}

        {/* 对话区 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column' }}>
          {messages.length === 0 && !streaming && (
            <div style={{ textAlign: 'center', color: '#9ca3af', marginTop: 60 }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🔌</div>
              <div style={{ marginBottom: 6 }}>已加载 {tools.length} 个 MCP 工具</div>
              <div style={{ fontSize: 12 }}>试着问：「检查这段代码的质量」或「vue 包最新版本是多少？」</div>
            </div>
          )}

          {messages.map(m => <ChatBubble key={m.id} message={m} />)}
          {streaming && <ChatBubble isStreaming streamContent={streamContent} message={{ role: 'assistant' }} />}
          <div ref={bottomRef} />
        </div>

        {/* 输入区 */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid #e5e7eb', display: 'flex', gap: 10 }}>
          <input
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendChat()}
            placeholder="输入问题，AI 会自动调用合适的 MCP 工具..."
            disabled={chatLoading}
            style={{ flex: 1, padding: '9px 14px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, outline: 'none' }}
          />
          <button
            onClick={sendChat}
            disabled={chatLoading || !chatInput.trim()}
            style={{
              padding: '9px 20px', background: '#4f46e5', color: '#fff',
              border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13,
              opacity: (chatLoading || !chatInput.trim()) ? .45 : 1,
            }}
          >
            {chatLoading ? '...' : '发送'}
          </button>
        </div>
      </div>
    </div>
  )
}
