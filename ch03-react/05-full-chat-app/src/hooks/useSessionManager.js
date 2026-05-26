// 05-full-chat-app/src/hooks/useSessionManager.js
import { useState, useCallback, useEffect } from 'react'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000'
const STORAGE_KEY = 'ch03_react_sessions'

export function useSessionManager() {
  const [sessions, setSessions] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') }
    catch { return [] }
  })
  const [currentId, setCurrentId] = useState(() =>
    JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')[0]?.id ?? null
  )

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
  }, [sessions])

  const createSession = useCallback(async (title = '新对话') => {
    const res = await fetch(`${API_BASE}/api/sessions`, { method: 'POST' })
      .catch(() => ({ json: async () => ({ sessionId: `local-${Date.now()}` }) }))
    const { sessionId } = await res.json()

    const s = { id: sessionId, title, createdAt: new Date().toISOString(), messageCount: 0 }
    setSessions(prev => [s, ...prev])
    setCurrentId(sessionId)
    return sessionId
  }, [])

  const deleteSession = useCallback(async (id) => {
    fetch(`${API_BASE}/api/sessions/${id}`, { method: 'DELETE' }).catch(() => {})
    setSessions(prev => prev.filter(s => s.id !== id))
    setCurrentId(prev => {
      if (prev !== id) return prev
      const rest = sessions.filter(s => s.id !== id)
      return rest[0]?.id ?? null
    })
  }, [sessions])

  const switchSession = useCallback((id) => setCurrentId(id), [])

  const updateTitle = useCallback((id, title) => {
    setSessions(prev => prev.map(s => s.id === id ? { ...s, title: title.slice(0, 28) } : s))
  }, [])

  const incrementCount = useCallback((id) => {
    setSessions(prev => prev.map(s => s.id === id ? { ...s, messageCount: s.messageCount + 1 } : s))
  }, [])

  return { sessions, currentId, createSession, deleteSession, switchSession, updateTitle, incrementCount }
}
