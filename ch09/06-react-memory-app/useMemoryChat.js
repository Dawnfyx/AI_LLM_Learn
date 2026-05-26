// 06-react-memory-app/useMemoryChat.js
import { useState, useCallback, useEffect } from 'react'

const API = 'http://localhost:3000'

export function useMemoryChat(initialUserId = 'user-demo') {
  const [userId, setUserId]       = useState(initialUserId)
  const [messages, setMessages]   = useState([])
  const [profile, setProfile]     = useState({})
  const [loading, setLoading]     = useState(false)
  const [streaming, setStreaming] = useState(false)
  let msgId = 0

  const loadProfile = useCallback(async (uid = userId) => {
    try {
      const res = await fetch(`${API}/api/profile/${uid}`)
      setProfile(await res.json())
    } catch {}
  }, [userId])

  useEffect(() => { loadProfile() }, [userId])

  const send = useCallback(async (text) => {
    if (!text.trim() || loading) return

    setLoading(true)
    setMessages(prev => [...prev, { id: ++msgId, role: 'user', content: text }])

    const aiMsg = { id: ++msgId, role: 'assistant', content: '', memories: [], streaming: true }
    setMessages(prev => [...prev, aiMsg])

    try {
      const res = await fetch(`${API}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, message: text }),
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
            if (event === 'memories') {
              setMessages(prev => prev.map(m => m.id === aiMsg.id ? { ...m, memories: data.items } : m))
            }
            if (event === 'token') {
              aiMsg.content += data.token
              setMessages(prev => prev.map(m => m.id === aiMsg.id ? { ...m, content: aiMsg.content } : m))
            }
            if (event === 'done') {
              setMessages(prev => prev.map(m => m.id === aiMsg.id ? { ...m, streaming: false } : m))
              setTimeout(() => loadProfile(), 1500)
            }
          } catch {}
        }
      }
    } finally {
      setLoading(false)
    }
  }, [userId, loading, loadProfile])

  const clearMemory = useCallback(async () => {
    if (!confirm('确定清除所有记忆和画像？')) return
    await fetch(`${API}/api/memories/${userId}`, { method: 'DELETE' })
    setProfile({})
    setMessages([])
  }, [userId])

  return { userId, setUserId, messages, profile, loading, send, clearMemory, loadProfile }
}
