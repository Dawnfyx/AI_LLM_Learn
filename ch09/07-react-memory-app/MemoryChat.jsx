// 07-react-memory-app/MemoryChat.jsx
import { useState, useRef, useEffect } from 'react'
import { useMemoryChat } from './useMemoryChat'

const CATEGORY_CONFIG = {
  preference: { label: '偏好', bg: '#ede9fe', color: '#7c3aed', border: '#8b5cf6' },
  fact:       { label: '背景', bg: '#dbeafe', color: '#1d4ed8', border: '#3b82f6' },
  goal:       { label: '目标', bg: '#fef3c7', color: '#b45309', border: '#f59e0b' },
  event:      { label: '经历', bg: '#d1fae5', color: '#065f46', border: '#10b981' },
}

function MemoryItem({ memory, index, onDelete }) {
  const cfg = CATEGORY_CONFIG[memory.category] || CATEGORY_CONFIG.fact

  return (
    <div style={{
      padding: '10px 12px', border: `1px solid #e5e7eb`,
      borderLeft: `3px solid ${cfg.border}`, borderRadius: 8,
      marginBottom: 8, background: '#fafafa',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
        <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 8, background: cfg.bg, color: cfg.color, fontWeight: 500 }}>
          {cfg.label}
        </span>
        <span style={{ fontSize: 10, color: '#f59e0b', marginLeft: 'auto' }}>
          {'★'.repeat(memory.importance)}
        </span>
        <button
          onClick={() => onDelete(index)}
          style={{ background: 'none', border: 'none', color: '#d1d5db', cursor: 'pointer', fontSize: 14, padding: '0 2px' }}
          onMouseEnter={e => e.target.style.color = '#ef4444'}
          onMouseLeave={e => e.target.style.color = '#d1d5db'}
        >×</button>
      </div>
      <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.6 }}>{memory.content}</div>
      {memory.tags?.length > 0 && (
        <div style={{ marginTop: 5, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {memory.tags.map(tag => (
            <span key={tag} style={{ fontSize: 10, background: '#f3f4f6', padding: '1px 5px', borderRadius: 4, color: '#6b7280' }}>
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export default function MemoryChat() {
  const [input, setInput] = useState('')
  const bottomRef = useRef(null)

  const {
    memories, userName, sessionCount, messages,
    loading, streaming, streamContent, hasPersonalization,
    send, deleteMemory,
  } = useMemoryChat()

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, streamContent])

  async function handleSend() {
    if (!input.trim() || loading) return
    const msg = input
    setInput('')
    await send(msg)
  }

  const sortedMemories = [...memories].sort((a, b) => b.importance - a.importance)

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: '-apple-system, sans-serif' }}>
      {/* 左：记忆面板 */}
      <div style={{ width: 280, background: '#fff', borderRight: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', fontWeight: 600, fontSize: 14, borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 8 }}>
          🧠 长期记忆
          <span style={{ fontSize: 11, background: '#ede9fe', color: '#6d28d9', padding: '2px 8px', borderRadius: 10, fontWeight: 400 }}>
            {memories.length}
          </span>
        </div>

        {/* 用户信息 */}
        <div style={{ padding: '14px 16px', display: 'flex', gap: 10, borderBottom: '1px solid #f3f4f6' }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#4f46e5', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 15, flexShrink: 0 }}>
            {userName ? userName[0] : 'U'}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{userName || '未设置姓名'}</div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{sessionCount} 次对话 · {memories.length} 条记忆</div>
          </div>
        </div>

        {/* 记忆列表 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
          {memories.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
              <div>暂无记忆</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>对话中提到的信息会自动记录</div>
            </div>
          ) : (
            sortedMemories.map((mem, idx) => (
              <MemoryItem key={idx} memory={mem} index={idx} onDelete={deleteMemory} />
            ))
          )}
        </div>
      </div>

      {/* 右：聊天区 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#f8f9fa' }}>
        {hasPersonalization && (
          <div style={{ padding: '8px 16px', background: '#eff6ff', borderBottom: '1px solid #bfdbfe', fontSize: 12, color: '#1d4ed8', display: 'flex', alignItems: 'center', gap: 6 }}>
            ✨ 已根据 {memories.length} 条历史记忆个性化本次对话
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {messages.length === 0 && !streaming && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#9ca3af', gap: 8 }}>
              <div style={{ fontSize: 40 }}>🤖</div>
              <div>开始对话，我会记住你说的重要信息</div>
              <div style={{ fontSize: 12 }}>每次对话结束后，关键信息会保存到左侧记忆面板</div>
            </div>
          )}

          {messages.map(msg => (
            <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '75%', padding: '10px 14px', borderRadius: msg.role === 'user' ? '12px 4px 12px 12px' : '4px 12px 12px 12px',
                background: msg.role === 'user' ? '#4f46e5' : '#fff',
                color: msg.role === 'user' ? '#fff' : '#1f2937',
                border: msg.role === 'user' ? 'none' : '1px solid #e5e7eb',
                fontSize: 14, lineHeight: 1.7, whiteSpace: 'pre-wrap',
              }}>
                {msg.content}
              </div>
              <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 3, padding: '0 4px' }}>{msg.time}</div>
            </div>
          ))}

          {streaming && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
              <div style={{ maxWidth: '75%', padding: '10px 14px', borderRadius: '4px 12px 12px 12px', background: '#fff', border: '1px solid #e5e7eb', fontSize: 14, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                {streamContent}
                <span style={{ display: 'inline-block', width: 2, height: '1em', background: '#374151', verticalAlign: 'text-bottom', animation: 'blink .7s infinite' }} />
                <style>{`@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}`}</style>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        <div style={{ padding: '12px 16px', background: '#fff', borderTop: '1px solid #e5e7eb', display: 'flex', gap: 10 }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && handleSend()}
            placeholder="输入消息... (Ctrl+Enter 发送)"
            rows={2}
            style={{ flex: 1, padding: '10px 14px', border: '1px solid #e5e7eb', borderRadius: 8, resize: 'none', fontSize: 14, fontFamily: 'inherit', outline: 'none' }}
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            style={{
              padding: '0 20px', background: '#4f46e5', color: '#fff',
              border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14,
              opacity: (loading || !input.trim()) ? .45 : 1,
            }}
          >
            {loading ? '...' : '发送'}
          </button>
        </div>
      </div>
    </div>
  )
}
