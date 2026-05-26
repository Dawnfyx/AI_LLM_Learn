// 06-react-perf-app/PerfDashboard.jsx
// React 版性能监控仪表盘
import { useState, useRef, useEffect, useCallback } from 'react'

const API = 'http://localhost:3000'

// 指标卡片
function MetricCard({ label, value, sub, color, icon }) {
  const colors = {
    purple: '#8b5cf6', blue: '#3b82f6', amber: '#f59e0b', green: '#22c55e',
  }
  return (
    <div style={{
      flex: 1, padding: '14px 16px', borderRadius: 10,
      background: '#fff', border: '1px solid #e5e7eb',
      borderTop: `3px solid ${colors[color]}`,
    }}>
      <div style={{ fontSize: 20, marginBottom: 6 }}>{icon}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: '#1f2937' }}>{value}</div>
      <div style={{ fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.06em', marginTop: 2 }}>{label}</div>
      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 3 }}>{sub}</div>
    </div>
  )
}

// 实时监控面板
function MonitorPanel({ monitor }) {
  const cache = monitor.cache || {}
  const cost  = monitor.cost  || {}
  const rl    = monitor.rateLimiter || {}

  return (
    <div style={{ width: 260, background: '#fff', overflowY: 'auto', borderLeft: '1px solid #e5e7eb' }}>
      <div style={{ padding: '12px 16px', fontWeight: 600, fontSize: 13, borderBottom: '1px solid #e5e7eb' }}>
        📊 实时监控
      </div>

      {/* 缓存状态 */}
      <MonitorSection title="缓存状态">
        <StatRow label="缓存条目" value={cache.size || 0} />
        <StatRow label="节省费用" value={cache.totalSavedUSD || '$0'} highlight />
        <div style={{ height: 6, background: '#e5e7eb', borderRadius: 3, overflow: 'hidden', margin: '6px 0 2px' }}>
          <div style={{ height: '100%', background: '#4f46e5', borderRadius: 3, width: cache.hitRate || '0%', transition: 'width .5s' }} />
        </div>
        <div style={{ fontSize: 10, color: '#9ca3af' }}>命中率 {cache.hitRate || '0%'}</div>
      </MonitorSection>

      {/* 最近调用 */}
      <MonitorSection title="最近调用">
        {(cost.recentRecords || []).length === 0 ? (
          <div style={{ fontSize: 12, color: '#9ca3af', textAlign: 'center', padding: '8px 0' }}>暂无记录</div>
        ) : (
          (cost.recentRecords || []).map((r, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#6b7280', padding: '3px 0', borderBottom: '1px solid #f9fafb' }}>
              <span style={{ color: '#9ca3af', fontFamily: 'monospace' }}>{r.time?.slice(11, 19)}</span>
              <span>{r.inputT}in/{r.outputT}out</span>
              <span style={{ color: '#f59e0b', fontWeight: 500 }}>¥{r.cny?.toFixed(4)}</span>
            </div>
          ))
        )}
      </MonitorSection>

      {/* 费用总计 */}
      <MonitorSection title="费用总计">
        <StatRow label="总 Token" value={(cost.tokens || 0).toLocaleString()} />
        <StatRow label="总费用(USD)" value={cost.costUSD || '$0'} />
        <StatRow label="总费用(CNY)" value={cost.costCNY || '¥0'} highlight />
      </MonitorSection>

      {/* 限流状态 */}
      <MonitorSection title="限流状态">
        <StatRow label="当前令牌" value={`${parseFloat(rl.currentTokens || 0).toFixed(0)} / ${rl.capacity || 20}`} />
        <StatRow label="补充速率" value={rl.refillRate || '5/s'} />
      </MonitorSection>
    </div>
  )
}

function MonitorSection({ title, children }) {
  return (
    <div style={{ padding: '12px 16px', borderBottom: '1px solid #f3f4f6' }}>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9ca3af', marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  )
}

function StatRow({ label, value, highlight }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#374151', marginBottom: 5 }}>
      <span>{label}</span>
      <span style={highlight ? { color: '#4f46e5', fontWeight: 600 } : {}}>{value}</span>
    </div>
  )
}

// 主组件
export default function PerfDashboard() {
  const [input, setInput]     = useState('')
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)
  const [monitor, setMonitor] = useState({})
  const bottomRef             = useRef(null)
  const msgIdRef              = useRef(0)

  const loadMonitor = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/monitor`)
      setMonitor(await res.json())
    } catch {}
  }, [])

  useEffect(() => {
    loadMonitor()
    const timer = setInterval(loadMonitor, 5000)
    return () => clearInterval(timer)
  }, [loadMonitor])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, messages[messages.length - 1]?.content])

  async function send() {
    if (!input.trim() || loading) return
    const msg = input; setInput(''); setLoading(true)

    const userMsgId = ++msgIdRef.current
    setMessages(prev => [...prev, { id: userMsgId, role: 'user', content: msg }])

    const aiMsgId = ++msgIdRef.current
    setMessages(prev => [...prev, { id: aiMsgId, role: 'assistant', content: '', streaming: true }])

    try {
      const res = await fetch(`${API}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      })

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer    = ''

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
            if (event === 'cache_hit') {
              setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, fromCache: true } : m))
            }
            if (event === 'token') {
              setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, content: m.content + data.token } : m))
            }
            if (event === 'done') {
              setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, streaming: false, cost: data.cost, fromCache: data.fromCache } : m))
              loadMonitor()
            }
          } catch {}
        }
      }
    } finally {
      setLoading(false)
    }
  }

  // 计算命中率数字
  const hitRate = (() => {
    const h = monitor.cache?.hits || 0
    const m = monitor.cache?.misses || 0
    return (h + m) === 0 ? 0 : (h / (h + m) * 100).toFixed(1)
  })()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: '-apple-system, sans-serif', background: '#f8f9fa' }}>
      {/* 顶部指标卡片 */}
      <div style={{ display: 'flex', gap: 12, padding: 16 }}>
        <MetricCard label="缓存命中率" value={`${hitRate}%`} sub={`命中 ${monitor.cache?.hits || 0} / 总 ${(monitor.cache?.hits || 0) + (monitor.cache?.misses || 0)}`} color="purple" icon="⚡" />
        <MetricCard label="今日 API 调用" value={monitor.cost?.calls || 0} sub={`均 ${monitor.cost?.avgPerCall || '$0'}/次`} color="blue" icon="🔗" />
        <MetricCard label="今日费用" value={monitor.cost?.costCNY || '¥0'} sub={monitor.cost?.costUSD || '$0'} color="amber" icon="💰" />
        <MetricCard label="限流桶余量" value={`${parseFloat(monitor.rateLimiter?.currentTokens || 0).toFixed(0)} / ${monitor.rateLimiter?.capacity || 20}`} sub={`补充速率 ${monitor.rateLimiter?.refillRate || '5/s'}`} color="green" icon="🪣" />
      </div>

      {/* 主内容 */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* 聊天区 */}
        <div style={{ flex: 1, background: '#fff', borderRight: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '12px 16px', fontWeight: 600, fontSize: 13, borderBottom: '1px solid #e5e7eb' }}>💬 对话测试</div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: 13, marginTop: 40 }}>发送消息，观察右侧指标变化</div>
            )}
            {messages.map(msg => {
              const isUser = msg.role === 'user'
              return (
                <div key={msg.id} style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', gap: 6, alignItems: 'flex-end' }}>
                  <div>
                    <div style={{
                      maxWidth: 400, padding: '9px 13px', borderRadius: isUser ? '10px 3px 10px 10px' : '3px 10px 10px 10px',
                      background: isUser ? '#4f46e5' : '#f3f4f6', color: isUser ? '#fff' : '#374151',
                      fontSize: 13, lineHeight: 1.65,
                    }}>
                      {msg.content}
                      {msg.streaming && (
                        <>
                          <span style={{ display: 'inline-block', width: 2, height: '1em', background: 'currentColor', verticalAlign: 'text-bottom', animation: 'blink .7s infinite' }} />
                          <style>{`@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}`}</style>
                        </>
                      )}
                    </div>
                    {msg.fromCache && (
                      <div style={{ fontSize: 10, color: '#6d28d9', background: '#ede9fe', padding: '1px 6px', borderRadius: 8, display: 'inline-block', marginTop: 3 }}>⚡ 缓存</div>
                    )}
                    {msg.cost && !msg.fromCache && (
                      <div style={{ fontSize: 10, color: '#9ca3af', background: '#f3f4f6', padding: '1px 6px', borderRadius: 8, display: 'inline-block', marginTop: 3 }}>
                        ¥{msg.cost.cny?.toFixed(4)}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>

          <div style={{ padding: 12, borderTop: '1px solid #e5e7eb', display: 'flex', gap: 8 }}>
            <input
              value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && send()}
              placeholder="输入消息（相同消息会命中缓存）..."
              disabled={loading}
              style={{ flex: 1, padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: 7, fontSize: 13, outline: 'none' }}
            />
            <button onClick={send} disabled={loading || !input.trim()} style={{ padding: '8px 16px', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 13, opacity: (loading || !input.trim()) ? .4 : 1 }}>
              {loading ? '...' : '发送'}
            </button>
          </div>
        </div>

        <MonitorPanel monitor={monitor} />
      </div>
    </div>
  )
}
