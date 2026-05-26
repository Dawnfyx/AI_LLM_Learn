// 03-session-manager/useSessionManager.js
// 多会话管理 Hook：创建、切换、删除、持久化会话列表
import { useState, useCallback, useEffect } from 'react'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000'
const STORAGE_KEY = 'chat_sessions'

export function useSessionManager() {
  // 从 localStorage 恢复会话列表
  const [sessions, setSessions] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    } catch {
      return []
    }
  })

  const [currentId, setCurrentId] = useState(
    () => sessions[0]?.id ?? null
  )

  // 持久化到 localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
  }, [sessions])

  // 创建新会话
  const createSession = useCallback(async (title = '新对话') => {
    const res = await fetch(`${API_BASE}/api/sessions`, { method: 'POST' })
    const { sessionId } = await res.json()

    const newSession = {
      id: sessionId,
      title,
      createdAt: new Date().toISOString(),
      messageCount: 0,
    }

    setSessions(prev => [newSession, ...prev])
    setCurrentId(sessionId)
    return sessionId
  }, [])

  // 删除会话
  const deleteSession = useCallback(async (sessionId) => {
    await fetch(`${API_BASE}/api/sessions/${sessionId}`, { method: 'DELETE' }).catch(() => {})

    setSessions(prev => prev.filter(s => s.id !== sessionId))

    setCurrentId(prev => {
      if (prev !== sessionId) return prev
      const remaining = sessions.filter(s => s.id !== sessionId)
      return remaining[0]?.id ?? null
    })
  }, [sessions])

  // 切换会话
  const switchSession = useCallback((sessionId) => {
    setCurrentId(sessionId)
  }, [])

  // 更新会话标题（第一条消息作为标题）
  const updateTitle = useCallback((sessionId, title) => {
    setSessions(prev =>
      prev.map(s => s.id === sessionId ? { ...s, title: title.slice(0, 30) } : s)
    )
  }, [])

  // 增加消息计数
  const incrementCount = useCallback((sessionId) => {
    setSessions(prev =>
      prev.map(s => s.id === sessionId ? { ...s, messageCount: s.messageCount + 1 } : s)
    )
  }, [])

  const currentSession = sessions.find(s => s.id === currentId) ?? null

  return {
    sessions,
    currentId,
    currentSession,
    createSession,
    deleteSession,
    switchSession,
    updateTitle,
    incrementCount,
  }
}
