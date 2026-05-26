// 05-full-chat-app/src/components/InputArea.jsx
import { useState, useRef, useEffect } from 'react'

export function InputArea({ onSend, onCancel, loading, streaming }) {
  const [input, setInput] = useState('')
  const textareaRef = useRef(null)

  // 发送后聚焦回输入框
  useEffect(() => {
    if (!loading) textareaRef.current?.focus()
  }, [loading])

  function handleKeyDown(e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleSend()
    }
  }

  function handleSend() {
    if (!input.trim() || loading) return
    onSend(input.trim())
    setInput('')
  }

  const charCount = input.length
  const isOverLimit = charCount > 4000

  return (
    <div style={{
      padding: '12px 16px',
      borderTop: '1px solid #e5e7eb',
      background: '#fff',
    }}>
      {/* 快捷键提示 */}
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: 11, color: '#9ca3af', marginBottom: 6,
      }}>
        <span>Ctrl+Enter 发送</span>
        <span style={{ color: isOverLimit ? '#ef4444' : '#9ca3af' }}>
          {charCount} / 4000
        </span>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息..."
          rows={3}
          style={{
            flex: 1,
            padding: '10px 14px',
            border: `1px solid ${isOverLimit ? '#ef4444' : '#e5e7eb'}`,
            borderRadius: 10,
            resize: 'none',
            fontSize: 14,
            lineHeight: 1.6,
            fontFamily: 'inherit',
            outline: 'none',
            transition: 'border-color 0.2s',
          }}
          onFocus={e => {
            if (!isOverLimit) e.target.style.borderColor = '#4f46e5'
          }}
          onBlur={e => {
            e.target.style.borderColor = isOverLimit ? '#ef4444' : '#e5e7eb'
          }}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading || isOverLimit}
            style={{
              padding: '10px 18px',
              background: '#4f46e5',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 500,
              opacity: (!input.trim() || loading || isOverLimit) ? 0.45 : 1,
              transition: 'opacity 0.2s',
            }}
          >
            发送
          </button>

          {streaming && (
            <button
              onClick={onCancel}
              style={{
                padding: '7px 12px',
                background: '#fff',
                color: '#dc2626',
                border: '1px solid #fecaca',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 12,
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
