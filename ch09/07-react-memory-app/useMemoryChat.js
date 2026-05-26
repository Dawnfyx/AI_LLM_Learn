// 07-react-memory-app/useMemoryChat.js
import { useState, useEffect, useCallback, useRef } from 'react'

const API = 'http://localhost:3000'

export function useMemoryChat(userId = 'demo_user_001') {
  const [memories, setMemories]         = useState([])
  const [sessionCount, setSessionCount] = useState(0)
  const [userName, setUserName]         = useState('')
  const [messages, setMessages]         = useState([])
  const [loading, setLoading]           = useState(false)
  const [streaming, setStreaming]       = useState(false)
  const [streamContent, setStreamContent] = useState('')
  const [hasPersonalization, setHasPersonalization] = useState(false)
  const sessionId = useRef(`session_${Date.now()}`)
  let msgId = useRef(0)

  const loadUserData = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/users/${userId}`)
      const data = await res.json()
      setMemories(data.memories || [])
      setUserName(data.name || '')
      setSessionCount(data.sessionCount || 0)
    } catch {}
  }, [userId])

  useEffect(() => { loadUserData() }, [loadUserData])

  const deleteMemory = useCallback(async (index) => {
    await fetch(`${API}/api/users/${userId}/memories/${index}`, { method: 'DELETE' })
    await loadUserData()
  }, [userId, loadUserData])

  const send = useCallback(async (text) => {
    if (!text.trim() || loading) return

    setLoading(true)
    const userMsgId = ++msgId.current
    setMessages(prev => [...prev, {
      id: userMsgId, role: 'user', content: text,
      time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    }])

    setStreaming(true)
    setStreamContent('')

    try {
      const res = await fetch(`${API}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, sessionId: sessionId.current, message: text }),
      })

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = '', full = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n'); buffer = parts.pop() ?? ''

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
            if (event === 'memory_loaded') setHasPersonalization(data.hasPersonalization)
            if (event === 'token') { full += data.token; setStreamContent(full) }
            if (event === 'memories_extracted') setTimeout(loadUserData, 2000)
            if (event === 'done') {
              setMessages(prev => [...prev, {
                id: ++msgId.current, role: 'assistant', content: full,
                time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
              }])
              setStreaming(false)
              setStreamContent('')
            }
          } catch {}
        }
      }
    } finally {
      setLoading(false)
    }
  }, [loading, userId, loadUserData])

  return {
    memories, userName, sessionCount, messages,
    loading, streaming, streamContent, hasPersonalization,
    send, deleteMemory, loadUserData,
  }
}
