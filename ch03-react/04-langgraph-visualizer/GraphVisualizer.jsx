// 04-langgraph-visualizer/GraphVisualizer.jsx
// LangGraph 工作流可视化组件
// 把 LangGraph 的节点和边渲染成可视化流程图，便于调试和演示
import { useState, useEffect } from 'react'

// 节点状态颜色
const STATUS_COLORS = {
  idle:       { bg: '#f3f4f6', border: '#d1d5db', text: '#374151' },
  running:    { bg: '#eff6ff', border: '#3b82f6', text: '#1d4ed8' },
  done:       { bg: '#f0fdf4', border: '#22c55e', text: '#15803d' },
  error:      { bg: '#fef2f2', border: '#ef4444', text: '#b91c1c' },
  skipped:    { bg: '#fafafa', border: '#e5e7eb', text: '#9ca3af' },
}

function GraphNode({ node, status = 'idle', isActive }) {
  const colors = STATUS_COLORS[status]

  return (
    <div style={{
      padding: '10px 18px',
      background: colors.bg,
      border: `2px solid ${colors.border}`,
      borderRadius: 8,
      textAlign: 'center',
      minWidth: 120,
      position: 'relative',
      transition: 'all 0.3s',
      boxShadow: isActive ? `0 0 0 3px ${colors.border}40` : 'none',
    }}>
      {/* 节点图标 */}
      {node.icon && (
        <div style={{ fontSize: 18, marginBottom: 4 }}>{node.icon}</div>
      )}

      {/* 节点名称 */}
      <div style={{ fontSize: 13, fontWeight: 500, color: colors.text }}>
        {node.label}
      </div>

      {/* 节点说明 */}
      {node.description && (
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 3 }}>
          {node.description}
        </div>
      )}

      {/* 运行中动画 */}
      {status === 'running' && (
        <div style={{
          position: 'absolute', top: 4, right: 6,
          width: 8, height: 8, borderRadius: '50%',
          background: '#3b82f6',
          animation: 'pulse 1s infinite',
        }} />
      )}

      <style>{`@keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(1.3)} }`}</style>
    </div>
  )
}

function Arrow({ direction = 'down', label }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '4px 0' }}>
      {label && (
        <span style={{ fontSize: 10, color: '#9ca3af', marginBottom: 2 }}>{label}</span>
      )}
      <div style={{ fontSize: 18, color: '#9ca3af' }}>↓</div>
    </div>
  )
}

// ── 智能问题分流图 ────────────────────────────────────────────
const ROUTING_GRAPH = {
  nodes: [
    { id: 'start',    label: 'START',         icon: '▶',  description: '用户输入' },
    { id: 'classify', label: 'classify_intent', icon: '🧠', description: '意图分类' },
    { id: 'code',     label: 'code_helper',    icon: '💻', description: '代码帮助' },
    { id: 'concept',  label: 'explainer',      icon: '📖', description: '概念解释' },
    { id: 'resource', label: 'resource_guide', icon: '📚', description: '资源推荐' },
    { id: 'end',      label: 'END',            icon: '⏹',  description: '输出结果' },
  ],
  edges: [
    { from: 'start',    to: 'classify' },
    { from: 'classify', to: 'code',     label: 'code_help',  conditional: true },
    { from: 'classify', to: 'concept',  label: 'concept',    conditional: true },
    { from: 'classify', to: 'resource', label: 'resource',   conditional: true },
    { from: 'code',     to: 'end' },
    { from: 'concept',  to: 'end' },
    { from: 'resource', to: 'end' },
  ],
}

// ── 代码生成自我修正图 ────────────────────────────────────────
const REVIEW_GRAPH = {
  nodes: [
    { id: 'start',    label: 'START',    icon: '▶',  description: '输入需求' },
    { id: 'generate', label: 'generate', icon: '⚡', description: '生成代码' },
    { id: 'review',   label: 'review',   icon: '🔍', description: '审查代码' },
    { id: 'end',      label: 'END',      icon: '⏹',  description: '输出结果' },
  ],
  edges: [
    { from: 'start',    to: 'generate' },
    { from: 'generate', to: 'review' },
    { from: 'review',   to: 'end',      label: 'passed ✓',  conditional: true },
    { from: 'review',   to: 'generate', label: '未通过，重试', conditional: true },
  ],
}

// ── 流程图渲染组件 ────────────────────────────────────────────
function SimpleFlowChart({ graph, nodeStatuses = {}, title }) {
  return (
    <div style={{ padding: 20 }}>
      {title && (
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 16, color: '#374151' }}>
          {title}
        </div>
      )}

      {/* 简单的垂直布局 */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        {graph.nodes.map((node, i) => {
          const status = nodeStatuses[node.id] || 'idle'
          const isActive = status === 'running'

          // 找到分叉点（有多条出边的节点）
          const outEdges = graph.edges.filter(e => e.from === node.id)
          const isFork = outEdges.length > 1

          return (
            <div key={node.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
              <GraphNode node={node} status={status} isActive={isActive} />

              {/* 渲染边 */}
              {i < graph.nodes.length - 1 && (
                isFork ? (
                  // 分叉：横向展示多条边
                  <div style={{ marginTop: 4 }}>
                    <div style={{ fontSize: 11, color: '#6b7280', textAlign: 'center', marginBottom: 4 }}>
                      条件路由
                    </div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                      {outEdges.map(edge => (
                        <div key={edge.to} style={{
                          padding: '3px 10px', background: '#f0fdf4',
                          border: '1px solid #86efac', borderRadius: 12,
                          fontSize: 11, color: '#15803d',
                        }}>
                          → {edge.label || edge.to}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <Arrow label={outEdges[0]?.label} />
                )
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── 交互演示：模拟节点执行 ────────────────────────────────────
export function GraphVisualizerDemo() {
  const [activeGraph, setActiveGraph]     = useState('routing')
  const [nodeStatuses, setNodeStatuses]   = useState({})
  const [isRunning, setIsRunning]         = useState(false)
  const [logs, setLogs]                   = useState([])

  const graph = activeGraph === 'routing' ? ROUTING_GRAPH : REVIEW_GRAPH

  function addLog(msg) {
    setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), msg }])
  }

  async function sleep(ms) {
    return new Promise(r => setTimeout(r, ms))
  }

  async function runSimulation() {
    setIsRunning(true)
    setNodeStatuses({})
    setLogs([])

    if (activeGraph === 'routing') {
      // 模拟路由图执行
      const path = ['start', 'classify', 'concept', 'end']

      for (const nodeId of path) {
        setNodeStatuses(prev => ({ ...prev, [nodeId]: 'running' }))
        addLog(`执行节点：${nodeId}`)
        await sleep(800)
        setNodeStatuses(prev => ({ ...prev, [nodeId]: 'done' }))
      }
      addLog('流程执行完成 ✓')
    } else {
      // 模拟审查循环
      setNodeStatuses({ start: 'running' })
      addLog('开始执行...')
      await sleep(500)
      setNodeStatuses({ start: 'done' })

      for (let attempt = 1; attempt <= 2; attempt++) {
        setNodeStatuses(prev => ({ ...prev, generate: 'running' }))
        addLog(`第 ${attempt} 次生成代码...`)
        await sleep(900)
        setNodeStatuses(prev => ({ ...prev, generate: 'done' }))

        setNodeStatuses(prev => ({ ...prev, review: 'running' }))
        addLog('审查代码...')
        await sleep(700)

        if (attempt === 2) {
          setNodeStatuses(prev => ({ ...prev, review: 'done', end: 'running' }))
          addLog('审查通过 ✓，流程结束')
          await sleep(500)
          setNodeStatuses(prev => ({ ...prev, end: 'done' }))
        } else {
          setNodeStatuses(prev => ({ ...prev, review: 'error' }))
          addLog('审查未通过，重新生成...')
          await sleep(600)
          setNodeStatuses(prev => ({ ...prev, review: 'idle' }))
        }
      }
    }

    setIsRunning(false)
  }

  return (
    <div style={{ display: 'flex', gap: 0, height: '100vh', fontFamily: 'sans-serif' }}>
      {/* 左：图形 */}
      <div style={{ width: 320, borderRight: '1px solid #e5e7eb', overflowY: 'auto' }}>
        <div style={{ padding: '16px', borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 10 }}>选择图结构</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {['routing', 'review'].map(type => (
              <button
                key={type}
                onClick={() => { setActiveGraph(type); setNodeStatuses({}); setLogs([]) }}
                style={{
                  padding: '5px 14px', fontSize: 12, borderRadius: 5, cursor: 'pointer',
                  background: activeGraph === type ? '#4f46e5' : '#f3f4f6',
                  color: activeGraph === type ? '#fff' : '#374151',
                  border: activeGraph === type ? 'none' : '1px solid #e5e7eb',
                }}
              >
                {type === 'routing' ? '条件路由' : '循环修正'}
              </button>
            ))}
          </div>
        </div>

        <SimpleFlowChart
          graph={graph}
          nodeStatuses={nodeStatuses}
          title={activeGraph === 'routing' ? '智能问题分流图' : '代码生成自我修正图'}
        />
      </div>

      {/* 右：控制台 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 14, fontWeight: 500 }}>执行日志</span>
          <button
            onClick={runSimulation}
            disabled={isRunning}
            style={{
              padding: '7px 20px', background: isRunning ? '#9ca3af' : '#4f46e5',
              color: '#fff', border: 'none', borderRadius: 6,
              cursor: isRunning ? 'not-allowed' : 'pointer', fontSize: 13,
            }}
          >
            {isRunning ? '执行中...' : '▶ 运行模拟'}
          </button>
        </div>

        {/* 图例 */}
        <div style={{ padding: '10px 16px', borderBottom: '1px solid #f3f4f6', display: 'flex', gap: 16, fontSize: 12 }}>
          {Object.entries(STATUS_COLORS).map(([status, colors]) => (
            <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: colors.bg, border: `1.5px solid ${colors.border}` }} />
              <span style={{ color: '#6b7280' }}>{status}</span>
            </div>
          ))}
        </div>

        {/* 日志 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16, fontFamily: 'monospace', fontSize: 13 }}>
          {logs.length === 0 && (
            <div style={{ color: '#9ca3af' }}>点击"运行模拟"查看执行过程</div>
          )}
          {logs.map((log, i) => (
            <div key={i} style={{ marginBottom: 6 }}>
              <span style={{ color: '#9ca3af', marginRight: 8 }}>{log.time}</span>
              <span style={{ color: '#374151' }}>{log.msg}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
