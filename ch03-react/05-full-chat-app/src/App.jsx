// 05-full-chat-app/src/App.jsx
// 完整 React 聊天应用：多会话 + 流式输出 + Markdown 渲染 + LangGraph 可视化
import { useState, useRef, useEffect, useCallback } from 'react'
import { useSessionManager } from './hooks/useSessionManager'
import { SessionSidebar } from './components/SessionSidebar'
import { MessageList } from './components/MessageList'
import { InputArea } from './components/InputArea'
import { GraphVisualizer } from './components/GraphVisualizer'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000'

export default function App() {
  const [view, setView] = useState('chat') // 'chat' | 'graph'

  const {
    sessions,
    currentId,
    createSession,
    deleteSession,
    switchSession,
    updateTitle,
    incrementCount,
  } = useSessionManager()

  // 每个 session 独立的消息列表
  const [allMessages, setAllMessages] = useState({})
  const [loading, setLoading] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [streamContent, setStreamContent] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('你是前端开发助手，回答简洁专业。')
  const abortRef = useRef(null)

  const currentMessages = allMessages[currentId] ?? []

  // 添加消息到当前会话
  const addMessage = useCallback((sessionId, msg) => {
    setAllMessages(prev => ({
      ...prev,
      [sessionId]: [...(prev[sessionId] ?? []), { ...msg, id: Date.now() + Math.random() }],
    }))
  }, [])

  // 新建会话并切换
  async function handleNewSession() {
    const id = await createSession()
    setAllMessages(prev => ({ ...prev, [id]: [] }))
  }

  // 发送消息
  async function handleSend(userInput) {
    if (!userInput.trim() || loading) return

    let sessionId = currentId
    if (!sessionId) {
      sessionId = await createSession()
    }

    setLoading(true)

    // 立即渲染用户消息
    addMessage(sessionId, {
      role: 'user',
      content: userInput,
      time: now(),
    })

    // 第一条消息作为会话标题
    const msgs = allMessages[sessionId] ?? []
    if (msgs.length === 0) {
      updateTitle(sessionId, userInput)
    }

    incrementCount(sessionId)

    // 流式请求
    setStreaming(true)
    setStreamContent('')

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch(`${API_BASE}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: userInput, systemPrompt }),
        signal: controller.signal,
      })

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer    = ''
      let full      = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (data.token) {
                full += data.token
                setStreamContent(full)
              }
            } catch {}
          }
          if (line === 'event: done') {
            addMessage(sessionId, { role: 'assistant', content: full, time: now() })
            incrementCount(sessionId)
            setStreaming(false)
            setStreamContent('')
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        addMessage(sessionId, {
          role: 'assistant',
          content: `发生错误：${err.message}`,
          time: now(),
          isError: true,
        })
      }
      setStreaming(false)
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }

  function handleCancel() {
    abortRef.current?.abort()
    setStreaming(false)
    setLoading(false)
    setStreamContent('')
  }

  function now() {
    return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      {/* 侧边栏 */}
      <SessionSidebar
        sessions={sessions}
        currentId={currentId}
        onCreate={handleNewSession}
        onSwitch={switchSession}
        onDelete={deleteSession}
        view={view}
        onViewChange={setView}
      />

      {/* 主内容区 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {view === 'graph' ? (
          <GraphVisualizer />
        ) : (
          <>
            {/* 顶部：system prompt 选择 */}
            <div style={{
              padding: '10px 16px', borderBottom: '1px solid #e5e7eb',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <span style={{ fontSize: 13, color: '#6b7280' }}>角色：</span>
              <select
                value={systemPrompt}
                onChange={e => setSystemPrompt(e.target.value)}
                style={{ fontSize: 13, border: '1px solid #e5e7eb', borderRadius: 5, padding: '4px 8px' }}
              >
                <option value="你是前端开发助手，回答简洁专业。">前端助手</option>
                <option value="你是代码审查专家，重点分析代码质量和潜在问题。">代码审查</option>
                <option value="你是技术架构师，擅长分析技术选型和架构设计。">架构师</option>
                <option value="你是前端面试官，针对前端知识点进行专业的面试提问和评价。">面试官</option>
              </select>
            </div>

            {/* 消息列表 */}
            <MessageList
              messages={currentMessages}
              streaming={streaming}
              streamContent={streamContent}
            />

            {/* 输入区 */}
            <InputArea
              onSend={handleSend}
              onCancel={handleCancel}
              loading={loading}
              streaming={streaming}
            />
          </>
        )}
      </div>
    </div>
  )
}
