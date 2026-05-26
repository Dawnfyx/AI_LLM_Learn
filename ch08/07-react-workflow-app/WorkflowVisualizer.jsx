// 07-react-workflow-app/WorkflowVisualizer.jsx
// React 版工作流可视化：hooks + 流程图渲染
import { useState, useCallback, useRef } from 'react'

const API = 'http://localhost:3000'

const FLOW_NODES = [
  { id: 'keywords', label: '关键词提取', icon: '🔑' },
  { id: 'outline',  label: '大纲生成',   icon: '📋' },
  { id: 'draft',    label: '内容撰写',   icon: '✍️' },
  { id: 'seo',      label: 'SEO 检查',  icon: '🔍' },
  { id: 'polish',   label: '润色发布',   icon: '✨' },
]

// 节点状态配置
const STATUS_CONFIG = {
  idle:    { border: '#e5e7eb', bg: '#fff',     badge: '#f3f4f6', badgeText: '#9ca3af', label: '等待' },
  running: { border: '#3b82f6', bg: '#fff',     badge: '#eff6ff', badgeText: '#1d4ed8', label: '执行中', shadow: '0 0 0 3px #3b82f620' },
  done:    { border: '#22c55e', bg: '#f0fdf4',  badge: '#f0fdf4', badgeText: '#15803d', label: '完成' },
  error:   { border: '#ef4444', bg: '#fef2f2',  badge: '#fef2f2', badgeText: '#b91c1c', label: '失败' },
}

// 单个节点组件
function FlowNode({ node, draftStream }) {
  const cfg = STATUS_CONFIG[node.status] || STATUS_CONFIG.idle
  const showStream = node.id === 'draft' && node.status === 'running' && draftStream

  return (
    <div style={{
      border: `1.5px solid ${cfg.border}`, borderRadius: 10,
      background: cfg.bg, padding: '12px 14px',
      boxShadow: cfg.shadow || 'none',
      transition: 'all 0.25s', width: '100%',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 16 }}>{node.icon}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#374151', flex: 1 }}>{node.label}</span>
        <span style={{
          fontSize: 10, padding: '2px 8px', borderRadius: 10,
          background: cfg.badge, color: cfg.badgeText,
        }}>
          {cfg.label}
        </span>
      </div>

      {node.result && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280', padding: '6px 8px', background: 'rgba(0,0,0,.03)', borderRadius: 4 }}>
          {node.result}
        </div>
      )}

      {showStream && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#374151', maxHeight: 80, overflowY: 'auto', padding: '6px 8px', background: '#f9fafb', borderRadius: 4, whiteSpace: 'pre-wrap' }}>
          {draftStream}
          <span style={{ display: 'inline-block', width: 2, height: '1em', background: '#4f46e5', verticalAlign: 'text-bottom', animation: 'blink .7s infinite' }} />
          <style>{`@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}`}</style>
        </div>
      )}

      {node.status === 'running' && (
        <div style={{ height: 2, background: '#e5e7eb', borderRadius: 1, overflow: 'hidden', marginTop: 8 }}>
          <div style={{ height: '100%', width: '40%', background: '#3b82f6', animation: 'slide 1.2s ease-in-out infinite' }} />
          <style>{`@keyframes slide{0%{transform:translateX(-200%)}100%{transform:translateX(400%)}}`}</style>
        </div>
      )}
    </div>
  )
}

// 连接箭头
function FlowArrow({ active }) {
  const color = active ? '#22c55e' : '#e5e7eb'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', height: 28 }}>
      <div style={{ width: 2, height: 20, background: color, transition: 'background .3s' }} />
      <div style={{ width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: `6px solid ${color}`, transition: 'border-top-color .3s' }} />
    </div>
  )
}

// 主工作流 Hook
function useWorkflow() {
  const [nodeStates, setNodeStates] = useState(
    Object.fromEntries(FLOW_NODES.map(n => [n.id, { status: 'idle', result: null }]))
  )
  const [draftStream, setDraftStream] = useState('')
  const [summary, setSummary]         = useState(null)
  const [finalContent, setFinalContent] = useState('')
  const [running, setRunning]         = useState(false)

  const updateNode = useCallback((id, updates) => {
    setNodeStates(prev => ({ ...prev, [id]: { ...prev[id], ...updates } }))
  }, [])

  const run = useCallback(async (topic, audience) => {
    if (!topic.trim() || running) return

    setRunning(true)
    setDraftStream('')
    setFinalContent('')
    setSummary(null)
    setNodeStates(Object.fromEntries(FLOW_NODES.map(n => [n.id, { status: 'idle', result: null }])))

    try {
      const res = await fetch(`${API}/api/workflow/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, audience }),
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
            if (event === 'node_start') updateNode(data.node, { status: 'running' })
            if (event === 'token' && data.node === 'draft') setDraftStream(prev => prev + data.token)
            if (event === 'node_done') {
              updateNode(data.node, { status: 'done', result: data.result })
              if (data.node === 'draft') setDraftStream('')
              if (data.node === 'polish') setFinalContent(data.result || '')
            }
            if (event === 'complete') setSummary(data)
          } catch {}
        }
      }
    } catch (e) {
      console.error(e)
    } finally {
      setRunning(false)
    }
  }, [running, updateNode])

  return { nodeStates, draftStream, summary, finalContent, running, run }
}

// 主组件
export default function WorkflowVisualizer() {
  const [topic, setTopic]     = useState('Vue3 Composition API 实战指南')
  const [audience, setAudience] = useState('前端开发者')
  const { nodeStates, draftStream, summary, finalContent, running, run } = useWorkflow()

  const inputStyle = {
    width: '100%', padding: '7px 10px', border: '1px solid #e5e7eb',
    borderRadius: 6, fontSize: 13, boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit',
  }

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: '-apple-system, sans-serif', background: '#f8f9fa' }}>
      {/* 左：配置区 */}
      <div style={{ width: 240, background: '#fff', borderRight: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 16px', fontWeight: 600, fontSize: 14, borderBottom: '1px solid #e5e7eb' }}>⚙️ 工作流配置</div>

        <div style={{ padding: '12px 16px 0' }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 5 }}>文章主题</div>
          <input value={topic} onChange={e => setTopic(e.target.value)} style={inputStyle} disabled={running} placeholder="输入主题..." />
        </div>

        <div style={{ padding: '12px 16px 0' }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 5 }}>目标受众</div>
          <select value={audience} onChange={e => setAudience(e.target.value)} style={inputStyle} disabled={running}>
            <option>前端开发者</option>
            <option>初学者</option>
            <option>技术 Lead</option>
          </select>
        </div>

        <div style={{ padding: 16 }}>
          <button
            onClick={() => run(topic, audience)}
            disabled={running || !topic.trim()}
            style={{
              width: '100%', padding: '10px 0', background: '#4f46e5', color: '#fff',
              border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 500,
              opacity: (running || !topic.trim()) ? .45 : 1,
            }}
          >
            {running ? '执行中...' : '▶ 运行工作流'}
          </button>
        </div>

        {/* 结果摘要 */}
        {summary && (
          <div style={{ margin: '0 16px', padding: 12, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: '#9ca3af' }}>SEO 评分</span>
              <span style={{ fontSize: 13, fontWeight: 500, color: summary.seoScore >= 80 ? '#15803d' : '#b45309' }}>
                {summary.seoScore}/100
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: '#9ca3af' }}>文章字数</span>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{summary.wordCount} 字</span>
            </div>
            {summary.keywords?.length > 0 && (
              <div>
                <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 5 }}>关键词</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {summary.keywords.map(kw => (
                    <span key={kw} style={{ fontSize: 10, padding: '1px 6px', background: '#ede9fe', color: '#6d28d9', borderRadius: 8 }}>{kw}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 中：流程图 */}
      <div style={{ flex: 1, background: '#fff', borderRight: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', fontWeight: 600, fontSize: 14, borderBottom: '1px solid #e5e7eb' }}>📊 执行流程</div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
          {FLOW_NODES.map((node, idx) => {
            const state = nodeStates[node.id] || { status: 'idle', result: null }
            return (
              <div key={node.id} style={{ width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <FlowNode node={{ ...node, ...state }} draftStream={draftStream} />
                {idx < FLOW_NODES.length - 1 && (
                  <FlowArrow active={state.status === 'done'} />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* 右：输出预览 */}
      <div style={{ width: 300, background: '#fff', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', fontWeight: 600, fontSize: 14, borderBottom: '1px solid #e5e7eb' }}>📝 生成内容</div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {!finalContent ? (
            <div style={{ color: '#9ca3af', fontSize: 13, textAlign: 'center', marginTop: 40 }}>
              运行工作流后，最终文章将在这里展示
            </div>
          ) : (
            <div style={{ fontSize: 13, lineHeight: 1.75, whiteSpace: 'pre-wrap', color: '#374151' }}>
              {finalContent}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
