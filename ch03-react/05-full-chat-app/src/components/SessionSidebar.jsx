// 05-full-chat-app/src/components/SessionSidebar.jsx
export function SessionSidebar({ sessions, currentId, onCreate, onSwitch, onDelete, view, onViewChange }) {
  return (
    <aside style={{
      width: 248,
      background: '#f9fafb',
      borderRight: '1px solid #e5e7eb',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
    }}>
      {/* Logo 区 */}
      <div style={{ padding: '18px 16px 12px', borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ fontWeight: 700, fontSize: 16, color: '#1f2937', marginBottom: 12 }}>
          ⚡ AI Chat
        </div>
        <button
          onClick={onCreate}
          style={{
            width: '100%', padding: '8px 0',
            background: '#4f46e5', color: '#fff',
            border: 'none', borderRadius: 8,
            cursor: 'pointer', fontSize: 13, fontWeight: 500,
          }}
        >
          ＋ 新建对话
        </button>
      </div>

      {/* 导航 Tab */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb' }}>
        {[
          { key: 'chat', label: '对话' },
          { key: 'graph', label: '流程图' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => onViewChange(tab.key)}
            style={{
              flex: 1, padding: '8px 0', fontSize: 12,
              background: view === tab.key ? '#fff' : 'transparent',
              color: view === tab.key ? '#4f46e5' : '#6b7280',
              border: 'none',
              borderBottom: view === tab.key ? '2px solid #4f46e5' : '2px solid transparent',
              cursor: 'pointer', fontWeight: view === tab.key ? 500 : 400,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 会话列表 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {sessions.length === 0 && (
          <div style={{ padding: '20px 16px', color: '#9ca3af', fontSize: 13, textAlign: 'center' }}>
            暂无对话
          </div>
        )}

        {sessions.map(s => (
          <div
            key={s.id}
            onClick={() => onSwitch(s.id)}
            style={{
              padding: '9px 14px',
              background: s.id === currentId ? '#ede9fe' : 'transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              borderRadius: '0 6px 6px 0',
              marginRight: 6,
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => { if (s.id !== currentId) e.currentTarget.style.background = '#f3f4f6' }}
            onMouseLeave={e => { if (s.id !== currentId) e.currentTarget.style.background = 'transparent' }}
          >
            <span style={{ fontSize: 14 }}>💬</span>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 13,
                fontWeight: s.id === currentId ? 500 : 400,
                color: s.id === currentId ? '#4f46e5' : '#374151',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {s.title}
              </div>
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>
                {s.messageCount} 条
              </div>
            </div>

            <button
              onClick={e => { e.stopPropagation(); onDelete(s.id) }}
              style={{
                background: 'none', border: 'none',
                color: '#d1d5db', cursor: 'pointer',
                fontSize: 15, padding: '1px 3px',
                borderRadius: 3,
                flexShrink: 0,
              }}
              onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
              onMouseLeave={e => e.currentTarget.style.color = '#d1d5db'}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </aside>
  )
}
