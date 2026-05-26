// 01-useChat-hook/ChatDemo.jsx
// useChat hook 的最简用法示例
import { useState, useRef, useEffect } from 'react'
import { useChat } from './useChat'

export default function ChatDemo() {
  const [input, setInput] = useState('')
  const bottomRef = useRef(null)

  const {
    messages,
    loading,
    streaming,
    streamContent,
    error,
    send,
    cancel,
    clearSession,
  } = useChat({ systemPrompt: '你是一位 Vue3 和 React 技术专家，回答简洁。' })

  // 新消息时自动滚到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamContent])

  async function handleSend() {
    if (!input.trim() || loading) return
    const msg = input
    setInput('')
    await send(msg)
  }

  function handleKeyDown(e) {
    // Ctrl+Enter 或 Cmd+Enter 发送
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleSend()
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', maxWidth: 800, margin: '0 auto' }}>
      {/* 顶部工具栏 */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 500 }}>useChat Hook 演示</span>
        <button onClick={clearSession} style={{ fontSize: 13, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer' }}>
          清空会话
        </button>
      </div>

      {/* 消息列表 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: '#9ca3af', marginTop: 40 }}>
            开始对话吧，支持 Ctrl+Enter 快速发送
          </div>
        )}

        {messages.map(msg => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* 流式输出的临时消息 */}
        {streaming && (
          <MessageBubble
            message={{ role: 'assistant', content: streamContent }}
            isStreaming
          />
        )}

        {/* 错误提示 */}
        {error && (
          <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#dc2626', fontSize: 13 }}>
            错误：{error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* 输入区 */}
      <div style={{ padding: 16, borderTop: '1px solid #e5e7eb', display: 'flex', gap: 8 }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息... (Ctrl+Enter 发送)"
          rows={3}
          style={{
            flex: 1, padding: '10px 14px', border: '1px solid #d1d5db',
            borderRadius: 8, resize: 'none', fontSize: 14, fontFamily: 'inherit',
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            style={{
              padding: '10px 20px', background: '#4f46e5', color: '#fff',
              border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14,
              opacity: (!input.trim() || loading) ? 0.5 : 1,
            }}
          >
            {loading ? '...' : '发送'}
          </button>
          {streaming && (
            <button
              onClick={cancel}
              style={{
                padding: '6px 12px', background: '#fee2e2', color: '#dc2626',
                border: '1px solid #fecaca', borderRadius: 6, cursor: 'pointer', fontSize: 12,
              }}
            >
              停止
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ message, isStreaming }) {
  const isUser = message.role === 'user'

  return (
    <div style={{
      display: 'flex',
      flexDirection: isUser ? 'row-reverse' : 'row',
      gap: 10,
      alignItems: 'flex-start',
    }}>
      {/* 头像 */}
      <div style={{
        width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
        background: isUser ? '#059669' : '#4f46e5',
        color: '#fff', display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: 13, fontWeight: 500,
      }}>
        {isUser ? '我' : 'AI'}
      </div>

      {/* 气泡 */}
      <div style={{
        maxWidth: '70%', padding: '10px 14px', borderRadius: 12,
        background: isUser ? '#4f46e5' : '#f3f4f6',
        color: isUser ? '#fff' : '#374151',
        fontSize: 14, lineHeight: 1.7, wordBreak: 'break-word',
      }}>
        {message.content}
        {isStreaming && (
          <span style={{
            display: 'inline-block', width: 2, height: '1em',
            background: 'currentColor', marginLeft: 2, verticalAlign: 'text-bottom',
            animation: 'blink 0.7s infinite',
          }} />
        )}
        <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>
      </div>
    </div>
  )
}
