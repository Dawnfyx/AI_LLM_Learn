// 06-react-agent-app/AgentChat.jsx
import { useState, useRef, useEffect } from 'react'
import { useAgent } from './useAgent'

// 工具步骤卡片
function StepCard({ step }) {
  const [expanded, setExpanded] = useState(false)
  const isRunning = step.status === 'running'

  return (
    <div style={{
      background: '#fff', border: `1px solid ${isRunning ? '#3b82f6' : '#22c55e'}`,
      borderRadius: 8, overflow: 'hidden', marginBottom: 6,
      boxShadow: isRunning ? '0 0 0 3px #3b82f620' : 'none',
      transition: 'all 0.2s',
    }}>
      <div
        onClick={() => step.result && setExpanded(v => !v)}
        style={{
          padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8,
          background: '#fafafa', cursor: step.result ? 'pointer' : 'default',
        }}
      >
        {/* 状态点 */}
        <div style={{
          width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
          background: isRunning ? '#3b82f6' : '#22c55e',
          animation: isRunning ? 'pulse 1s infinite' : 'none',
        }} />
        <style>{`@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(1.3)}}`}</style>

        <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600, color: '#374151', flex: 1 }}>
          {step.name}
        </span>
        {step.duration && <span style={{ fontSize: 10, color: '#9ca3af' }}>{step.duration}ms</span>}
        <span style={{
          fontSize: 10, padding: '1px 7px', borderRadius: 8,
          background: isRunning ? '#eff6ff' : '#f0fdf4',
          color: isRunning ? '#1d4ed8' : '#15803d',
        }}>
          {isRunning ? '执行中' : '完成'}
        </span>
        {step.result && <span style={{ fontSize: 10, color: '#9ca3af' }}>{expanded ? '▲' : '▼'}</span>}
      </div>

      {expanded && (
        <div style={{ padding: '8px 12px', borderTop: '1px solid #f3f4f6' }}>
          {step.args && (
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#9ca3af', marginBottom: 3 }}>入参</div>
              <pre style={{ background: '#f8f9fa', border: '1px solid #e5e7eb', borderRadius: 4, padding: '6px 8px', fontSize: 11, fontFamily: 'monospace', margin: 0, maxHeight: 100, overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
                {typeof step.args === 'string' ? step.args : JSON.stringify(step.args, null, 2)}
              </pre>
            </div>
          )}
          {step.result && (
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#9ca3af', marginBottom: 3 }}>出参</div>
              <pre style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 4, padding: '6px 8px', fontSize: 11, fontFamily: 'monospace', margin: 0, maxHeight: 120, overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
                {typeof step.result === 'string' ? step.result : JSON.stringify(step.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// 消息组
function MessageGroup({ message }) {
  if (message.role === 'user') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <div style={{
          maxWidth: '70%', padding: '10px 14px',
          background: '#4f46e5', color: '#fff',
          borderRadius: '12px 4px 12px 12px', fontSize: 14, lineHeight: 1.7,
        }}>
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div style={{ marginBottom: 20, maxWidth: '85%' }}>
      {/* 步骤列表 */}
      {message.steps?.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {message.steps.map((step, i) => <StepCard key={i} step={step} />)}
        </div>
      )}
      {/* 回答 */}
      <div style={{
        padding: '12px 16px', background: '#fff', border: '1px solid #e5e7eb',
        borderRadius: '4px 12px 12px 12px', fontSize: 14, lineHeight: 1.75,
        whiteSpace: 'pre-wrap', color: '#1f2937',
      }}>
        {message.content}
      </div>
    </div>
  )
}

// 快捷操作按钮
const QUICK_ACTIONS = [
  'Vue3 v-model 怎么用？',
  '生成一个 React 数据获取 Hook',
  '分析：async getData() { fetch("/api").then(r => r.json()) }',
]

export default function AgentChat() {
  const [input, setInput] = useState('')
  const bottomRef = useRef(null)
  const { messages, steps, streamContent, loading, send, clear } = useAgent()

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, streamContent])

  async function handleSend(text) {
    const msg = text || input
    if (!msg.trim()) return
    setInput('')
    await send(msg)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: '-apple-system, sans-serif', background: '#f8f9fa' }}>
      {/* 顶部栏 */}
      <div style={{ padding: '12px 20px', background: '#fff', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontWeight: 600, fontSize: 15 }}>🤖 前端开发 Agent</span>
          <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 8 }}>查文档 · 分析代码 · 生成片段</span>
        </div>
        <button onClick={clear} style={{ fontSize: 12, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer' }}>
          清空对话
        </button>
      </div>

      {/* 消息区 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        {messages.length === 0 && steps.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#9ca3af', gap: 8 }}>
            <div style={{ fontSize: 48 }}>🤖</div>
            <div style={{ fontSize: 15 }}>前端开发 Agent 助手</div>
            <div style={{ fontSize: 12 }}>可以帮你查文档、分析代码、生成代码片段</div>
          </div>
        )}

        {messages.map(m => <MessageGroup key={m.id} message={m} />)}

        {/* 正在执行的步骤 */}
        {steps.length > 0 && loading && (
          <div style={{ maxWidth: '85%', marginBottom: 20 }}>
            {steps.map((step, i) => <StepCard key={i} step={step} />)}
            {streamContent && (
              <div style={{ padding: '12px 16px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '4px 12px 12px 12px', fontSize: 14, lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>
                {streamContent}
                <span style={{ display: 'inline-block', width: 2, height: '1em', background: '#374151', verticalAlign: 'text-bottom', animation: 'blink .7s infinite' }} />
                <style>{`@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}`}</style>
              </div>
            )}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* 输入区 */}
      <div style={{ padding: '12px 16px', background: '#fff', borderTop: '1px solid #e5e7eb' }}>
        {/* 快捷操作 */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {QUICK_ACTIONS.map(action => (
            <button
              key={action}
              onClick={() => handleSend(action)}
              disabled={loading}
              style={{
                fontSize: 11, padding: '4px 10px',
                background: '#f3f4f6', border: '1px solid #e5e7eb',
                borderRadius: 12, cursor: 'pointer', color: '#374151',
                opacity: loading ? .45 : 1,
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => { if (!loading) { e.target.style.background = '#ede9fe'; e.target.style.borderColor = '#c4b5fd'; e.target.style.color = '#4f46e5' }}}
              onMouseLeave={e => { e.target.style.background = '#f3f4f6'; e.target.style.borderColor = '#e5e7eb'; e.target.style.color = '#374151' }}
            >
              {action.length > 20 ? action.slice(0, 20) + '...' : action}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && handleSend()}
            placeholder="输入问题... (Ctrl+Enter 发送)"
            rows={2}
            style={{ flex: 1, padding: '10px 14px', border: '1px solid #e5e7eb', borderRadius: 8, resize: 'none', fontSize: 14, fontFamily: 'inherit', outline: 'none' }}
          />
          <button
            onClick={() => handleSend()}
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
