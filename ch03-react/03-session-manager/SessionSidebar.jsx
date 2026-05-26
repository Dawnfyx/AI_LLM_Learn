// 03-session-manager/SessionSidebar.jsx
// 会话列表侧边栏组件
import { useSessionManager } from './useSessionManager'

export function SessionSidebar({ currentId, sessions, onCreate, onSwitch, onDelete }) {
  return (
    <aside style={{
      width: 240, background: '#f9fafb', borderRight: '1px solid #e5e7eb',
      display: 'flex', flexDirection: 'column', height: '100vh',
    }}>
      <div style={{
        padding: '16px', borderBottom: '1px solid #e5e7eb',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ fontWeight: 500, fontSize: 14 }}>对话列表</span>
        <button
          onClick={onCreate}
          style={{
            padding: '4px 12px', background: '#4f46e5', color: '#fff',
            border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 12,
          }}
        >
          ＋ 新建
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {sessions.length === 0 && (
          <div style={{ padding: 16, color: '#9ca3af', fontSize: 13, textAlign: 'center' }}>
            暂无对话
          </div>
        )}

        {sessions.map(session => (
          <div
            key={session.id}
            onClick={() => onSwitch(session.id)}
            style={{
              padding: '11px 14px',
              background: session.id === currentId ? '#ede9fe' : 'transparent',
              borderBottom: '1px solid #f3f4f6',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            {/* 会话图标 */}
            <span style={{ fontSize: 15 }}>💬</span>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 13, fontWeight: session.id === currentId ? 500 : 400,
                color: session.id === currentId ? '#4f46e5' : '#374151',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {session.title}
              </div>
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                {session.messageCount} 条消息
              </div>
            </div>

            {/* 删除按钮 */}
            <button
              onClick={e => { e.stopPropagation(); onDelete(session.id) }}
              style={{
                background: 'none', border: 'none', color: '#9ca3af',
                cursor: 'pointer', fontSize: 16, padding: '2px 4px', flexShrink: 0,
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </aside>
  )
}
