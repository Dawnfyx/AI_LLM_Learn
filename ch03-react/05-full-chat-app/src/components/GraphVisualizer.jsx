// 05-full-chat-app/src/components/GraphVisualizer.jsx
// 内嵌 LangGraph 可视化演示
import { useState } from 'react'

const STATUS_STYLE = {
  idle:    { bg: '#f3f4f6', border: '#d1d5db', text: '#374151', label: '待执行' },
  running: { bg: '#eff6ff', border: '#3b82f6', text: '#1d4ed8', label: '执行中' },
  done:    { bg: '#f0fdf4', border: '#22c55e', text: '#15803d', label: '已完成' },
  error:   { bg: '#fef2f2', border: '#ef4444', text: '#b91c1c', label: '失败' },
}

const GRAPHS = {
  routing: {
    title: '智能问题分流图',
    desc: '用户输入 → 意图分类 → 条件路由到对应处理节点',
    nodes: [
      { id: 'start',    label: 'START',           icon: '▶', desc: '接收用户输入' },
      { id: 'classify', label: 'classify_intent',  icon: '🧠', desc: 'GPT 意图分类' },
      { id: 'code',     label: 'code_helper',      icon: '💻', desc: '代码帮助节点' },
      { id: 'concept',  label: 'explainer',        icon: '📖', desc: '概念解释节点' },
      { id: 'resource', label: 'resource_guide',   icon: '📚', desc: '资源推荐节点' },
      { id: 'end',      label: 'END',              icon: '⏹', desc: '输出最终结果' },
    ],
    // 模拟路径
    paths: [
      ['start', 'classify', 'concept', 'end'],
      ['start', 'classify', 'code', 'end'],
      ['start', 'classify', 'resource', 'end'],
    ],
  },
  review: {
    title: '代码生成自我修正图',
    desc: '需求 → 生成代码 → 自动审查 → 未通过则重新生成',
    nodes: [
      { id: 'start',    label: 'START',    icon: '▶', desc: '输入需求' },
      { id: 'generate', label: 'generate', icon: '⚡', desc: '生成代码（GPT-4o）' },
      { id: 'review',   label: 'review',   icon: '🔍', desc: '审查代码质量' },
      { id: 'end',      label: 'END',      icon: '⏹', desc: '输出最终代码' },
    ],
    paths: [
      ['start', 'generate', 'review', 'generate', 'review', 'end'],
      ['start', 'generate', 'review', 'end'],
    ],
  },
}

function Node({ node, status = 'idle' }) {
  const s = STATUS_STYLE[status]
  return (
    <div style={{
      padding: '9px 16px', borderRadius: 8, textAlign: 'center',
      minWidth: 140, background: s.bg,
      border: `2px solid ${s.border}`,
      transition: 'all 0.3s',
      boxShadow: status === 'running' ? `0 0 0 4px ${s.border}30` : 'none',
    }}>
      <span style={{ fontSize: 16 }}>{node.icon}</span>
      <div style={{ fontSize: 12, fontWeight: 600, color: s.text, marginTop: 3 }}>
        {node.label}
      </div>
      <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>{node.desc}</div>
      {status !== 'idle' && (
        <div style={{
          fontSize: 10, marginTop: 4, padding: '1px 6px',
          background: s.border + '20', color: s.text, borderRadius: 10,
          display: 'inline-block',
        }}>
          {s.label}
        </div>
      )}
    </div>
  )
}

export function GraphVisualizer() {
  const [graphKey, setGraphKey] = useState('routing')
  const [pathIdx, setPathIdx] = useState(0)
  const [step, setStep] = useState(-1)
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState([])

  const graph = GRAPHS[graphKey]
  const path  = graph.paths[pathIdx] ?? graph.paths[0]

  // 当前每个节点的状态
  const nodeStatuses = {}
  if (step >= 0) {
    path.forEach((nodeId, i) => {
      if (i < step) nodeStatuses[nodeId] = 'done'
      else if (i === step) nodeStatuses[nodeId] = 'running'
    })
  }

  async function run() {
    setRunning(true)
    setStep(-1)
    setLogs([])

    for (let i = 0; i < path.length; i++) {
      setStep(i)
      const node = graph.nodes.find(n => n.id === path[i])
      setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] 执行：${node?.label || path[i]}`])
      await new Promise(r => setTimeout(r, 750))
    }

    setStep(path.length) // 全部完成
    setLogs(prev => [...prev, `✓ 流程执行完成（共 ${path.length} 个节点）`])
    setRunning(false)
  }

  function reset() {
    setStep(-1)
    setLogs([])
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* 左：图形区 */}
      <div style={{ width: 320, borderRight: '1px solid #e5e7eb', overflowY: 'auto', padding: 20 }}>
        {/* 图选择 */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {Object.keys(GRAPHS).map(k => (
            <button
              key={k}
              onClick={() => { setGraphKey(k); reset() }}
              style={{
                flex: 1, padding: '5px 0', fontSize: 12, borderRadius: 5, cursor: 'pointer',
                background: graphKey === k ? '#4f46e5' : '#f3f4f6',
                color: graphKey === k ? '#fff' : '#374151',
                border: graphKey === k ? 'none' : '1px solid #e5e7eb',
              }}
            >
              {GRAPHS[k].title.slice(0, 6)}
            </button>
          ))}
        </div>

        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 16 }}>{graph.desc}</div>

        {/* 节点列表（垂直） */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          {graph.nodes.map((node, i) => {
            const status = nodeStatuses[node.id] ||
              (step >= path.length && path.includes(node.id) ? 'done' : 'idle')

            return (
              <div key={node.id} style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <Node node={node} status={status} />
                {i < graph.nodes.length - 1 && (
                  <div style={{ color: '#9ca3af', fontSize: 18, lineHeight: 1.2 }}>↓</div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* 右：日志区 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* 控制栏 */}
        <div style={{
          padding: '12px 16px', borderBottom: '1px solid #e5e7eb',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 14, fontWeight: 500, flex: 1 }}>执行日志</span>

          {/* 路径选择 */}
          <select
            value={pathIdx}
            onChange={e => { setPathIdx(Number(e.target.value)); reset() }}
            style={{ fontSize: 12, padding: '4px 8px', border: '1px solid #e5e7eb', borderRadius: 5 }}
          >
            {graph.paths.map((p, i) => (
              <option key={i} value={i}>路径 {i + 1}（{p.length} 步）</option>
            ))}
          </select>

          <button
            onClick={running ? reset : run}
            style={{
              padding: '6px 16px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
              background: running ? '#fee2e2' : '#4f46e5',
              color: running ? '#dc2626' : '#fff',
              border: running ? '1px solid #fecaca' : 'none',
            }}
          >
            {running ? '⏹ 停止' : '▶ 运行'}
          </button>
        </div>

        {/* 图例 */}
        <div style={{ padding: '8px 16px', borderBottom: '1px solid #f3f4f6', display: 'flex', gap: 12 }}>
          {Object.entries(STATUS_STYLE).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: v.bg, border: `1.5px solid ${v.border}` }} />
              <span style={{ color: '#6b7280' }}>{v.label}</span>
            </div>
          ))}
        </div>

        {/* 日志输出 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16, fontFamily: 'monospace', fontSize: 13 }}>
          {logs.length === 0 ? (
            <div style={{ color: '#9ca3af' }}>点击"运行"查看节点执行过程...</div>
          ) : (
            logs.map((log, i) => (
              <div key={i} style={{ marginBottom: 6, color: log.startsWith('✓') ? '#15803d' : '#374151' }}>
                {log}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
