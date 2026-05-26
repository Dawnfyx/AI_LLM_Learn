// 05-full-chat-app/src/components/MessageList.jsx
import { useEffect, useRef } from 'react'
import { StreamMessage } from './StreamMessage'

export function MessageList({ messages, streaming, streamContent }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, streamContent])

  return (
    <div style={{
      flex: 1, overflowY: 'auto', padding: '20px 16px',
      display: 'flex', flexDirection: 'column', gap: 16,
    }}>
      {messages.length === 0 && !streaming && (
        <div style={{ textAlign: 'center', color: '#9ca3af', marginTop: 60 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>💬</div>
          <div>开始一段新对话吧</div>
          <div style={{ fontSize: 12, marginTop: 6 }}>支持 Ctrl+Enter 快速发送</div>
        </div>
      )}

      {messages.map(msg => (
        <Bubble key={msg.id} message={msg} />
      ))}

      {/* 流式输出的临时气泡 */}
      {streaming && (
        <Bubble
          message={{ role: 'assistant', content: streamContent }}
          isStreaming
        />
      )}

      <div ref={bottomRef} />
    </div>
  )
}

function Bubble({ message, isStreaming }) {
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
        justifyContent: 'center', fontSize: 12, fontWeight: 600,
      }}>
        {isUser ? '我' : 'AI'}
      </div>

      {/* 内容区 */}
      <div style={{ maxWidth: '72%' }}>
        <div style={{
          padding: '10px 14px',
          background: isUser ? '#4f46e5' : (message.isError ? '#fef2f2' : '#f9fafb'),
          border: message.isError ? '1px solid #fecaca' : 'none',
          color: isUser ? '#fff' : (message.isError ? '#dc2626' : '#1f2937'),
          borderRadius: isUser ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
        }}>
          {isUser ? (
            <div style={{ fontSize: 14, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
              {message.content}
            </div>
          ) : (
            <StreamMessage content={message.content} isStreaming={isStreaming} />
          )}
        </div>

        {message.time && (
          <div style={{
            fontSize: 11, color: '#9ca3af', marginTop: 4,
            textAlign: isUser ? 'right' : 'left',
            paddingLeft: isUser ? 0 : 4,
            paddingRight: isUser ? 4 : 0,
          }}>
            {message.time}
          </div>
        )}
      </div>
    </div>
  )
}
