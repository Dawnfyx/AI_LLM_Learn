// 06-react-memory-app/MemoryChat.jsx
import { useState, useRef, useEffect } from 'react'
import { useMemoryChat } from './useMemoryChat'

const LEVEL_STYLE = {
  senior:       { bg: '#fef3c7', color: '#92400e', text: '资深' },
  intermediate: { bg: '#dbeafe', color: '#1e40af', text: '中级' },
  beginner:     { bg: '#dcfce7', color: '#166534', text: '初级' },
}

function ProfilePanel({ profile, onClear, onRefresh }) {
  const isEmpty = !profile || Object.keys(profile).filter(k => {
    const v = profile[k]
    return v !== undefined && v !== null && v !== '' && (!Array.isArray(v) || v.length > 0)
  }).length === 0

  return (
    <div style={{ width: 240, background: '#fff', borderRight: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '14px 16px', fontWeight: 600, fontSize: 14, borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        👤 用户画像
        <button onClick={onRefresh} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#9ca3af' }}>↻</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {isEmpty ? (
          <div style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.6 }}>
            和 AI 多聊几句，它会自动学习你的偏好
          </div>
        ) : (
          <>
            {profile.name && <ProfileRow label="姓名" value={profile.name} />}
            {profile.techLevel && (
              <ProfileRow label="水平">
                <span style={{
                  display: 'inline-block', padding: '2px 8px', borderRadius: 4,
                  fontSize: 11, ...LEVEL_STYLE[profile.techLevel],
                }}>
                  {LEVEL_STYLE[profile.techLevel]?.text || profile.techLevel}
                </span>
              </ProfileRow>
            )}
            {profile.techStack?.length > 0 && (
              <ProfileRow label="技术栈">
                <TagList tags={profile.techStack} />
              </ProfileRow>
            )}
            {profile.currentGoal && <ProfileRow label="目标" value={profile.currentGoal} />}
            {profile.knownTopics?.length > 0 && (
              <ProfileRow label="已掌握">
                <TagList tags={profile.knownTopics.slice(0, 5)} color="green" />
              </ProfileRow>
            )}
          </>
        )}
      </div>

      <div style={{ padding: '12px 16px', borderTop: '1px solid #e5e7eb' }}>
        <button onClick={onClear} style={{ width: '100%', padding: '7px 0', background: 'none', border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', fontSize: 12, color: '#9ca3af' }}
          onMouseEnter={e => { e.target.style.borderColor = '#ef4444'; e.target.style.color = '#ef4444' }}
          onMouseLeave={e => { e.target.style.borderColor = '#e5e7eb'; e.target.style.color = '#9ca3af' }}
        >
          🗑 清除记忆
        </button>
      </div>
    </div>
  )
}

function ProfileRow({ label, value, children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9ca3af', marginBottom: 3 }}>{label}</div>
      {value ? <span style={{ fontSize: 13, color: '#374151' }}>{value}</span> : children}
    </div>
  )
}

function TagList({ tags, color }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {tags.map(t => (
        <span key={t} style={{
          fontSize: 10, padding: '2px 7px', borderRadius: 8,
          background: color === 'green' ? '#dcfce7' : '#f3f4f6',
          color: color === 'green' ? '#166534' : '#374151',
        }}>{t}</span>
      ))}
    </div>
  )
}

function MemoryHint({ memories }) {
  const [open, setOpen] = useState(false)
  if (!memories?.length) return null

  return (
    <div style={{ position: 'relative', marginBottom: 4 }}>
      <div
        onClick={() => setOpen(v => !v)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#6d28d9', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}
      >
        💡 引用了 {memories.length} 条历史记忆 {open ? '▲' : '▼'}
      </div>
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 10, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: 8, minWidth: 220, boxShadow: '0 4px 12px rgba(0,0,0,.08)', marginTop: 2 }}>
          {memories.map((m, i) => (
            <div key={i} style={{ fontSize: 11, color: '#374151', padding: '3px 0', borderBottom: '1px solid #f3f4f6' }}>{m}</div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function MemoryChat() {
  const [input, setInput] = useState('')
  const bottomRef = useRef(null)
  const { userId, setUserId, messages, profile, loading, send, clearMemory, loadProfile } = useMemoryChat()

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, messages[messages.length - 1]?.content])

  async function handleSend() {
    if (!input.trim() || loading) return
    const msg = input; setInput('')
    await send(msg)
  }

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: '-apple-system, sans-serif' }}>
      <ProfilePanel profile={profile} onClear={clearMemory} onRefresh={loadProfile} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#f8f9fa' }}>
        {/* 消息区 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {messages.length === 0 && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', gap: 8 }}>
              <div style={{ fontSize: 40 }}>🧠</div>
              <div>我会记住你的每次对话</div>
              <div style={{ fontSize: 12 }}>每次聊天结束，重要信息会自动存入长期记忆</div>
            </div>
          )}

          {messages.map(msg => {
            const isUser = msg.role === 'user'
            return (
              <div key={msg.id}>
                {!isUser && <MemoryHint memories={msg.memories} />}
                <div style={{ display: 'flex', flexDirection: isUser ? 'row-reverse' : 'row', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: isUser ? '#059669' : '#4f46e5', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>
                    {isUser ? '我' : 'AI'}
                  </div>
                  <div style={{
                    maxWidth: '78%', padding: '10px 14px',
                    background: isUser ? '#4f46e5' : '#fff',
                    color: isUser ? '#fff' : '#1f2937',
                    border: isUser ? 'none' : '1px solid #e5e7eb',
                    borderRadius: isUser ? '12px 4px 12px 12px' : '4px 12px 12px 12px',
                    fontSize: 14, lineHeight: 1.7,
                  }}>
                    {msg.content}
                    {msg.streaming && (
                      <>
                        <span style={{ display: 'inline-block', width: 2, height: '1em', background: '#374151', verticalAlign: 'text-bottom', animation: 'blink .7s infinite' }} />
                        <style>{`@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}`}</style>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>

        {/* 输入区 */}
        <div style={{ padding: '12px 16px', background: '#fff', borderTop: '1px solid #e5e7eb' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12, color: '#6b7280' }}>
            <span>用户 ID：</span>
            <input value={userId} onChange={e => setUserId(e.target.value)} style={{ padding: '3px 8px', border: '1px solid #e5e7eb', borderRadius: 4, fontSize: 12, width: 90, outline: 'none' }} />
            <span style={{ color: '#9ca3af', fontSize: 11 }}>（区分不同用户的记忆）</span>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && handleSend()}
              placeholder="输入消息... (Ctrl+Enter 发送)" rows={2}
              style={{ flex: 1, padding: '10px 14px', border: '1px solid #e5e7eb', borderRadius: 8, resize: 'none', fontSize: 14, fontFamily: 'inherit', outline: 'none' }}
            />
            <button onClick={handleSend} disabled={loading || !input.trim()} style={{ padding: '0 20px', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, opacity: (loading || !input.trim()) ? .45 : 1 }}>
              {loading ? '...' : '发送'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
