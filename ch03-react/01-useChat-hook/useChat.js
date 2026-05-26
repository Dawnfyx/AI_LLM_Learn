// 01-useChat-hook/useChat.js
// 核心 Hook：封装流式对话逻辑，在任意 React 组件里复用
import { useState, useRef, useCallback } from 'react'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000'

export function useChat({ systemPrompt = '你是前端开发助手，回答简洁专业。' } = {}) {
  const [messages, setMessages]         = useState([])
  const [loading, setLoading]           = useState(false)
  const [streaming, setStreaming]       = useState(false)
  const [streamContent, setStreamContent] = useState('')
  const [error, setError]               = useState(null)

  const sessionIdRef = useRef(null)
  const abortRef     = useRef(null) // 用于取消请求

  // 初始化会话
  const initSession = useCallback(async () => {
    const res = await fetch(`${API_BASE}/api/sessions`, { method: 'POST' })
    const { sessionId } = await res.json()
    sessionIdRef.current = sessionId
    return sessionId
  }, [])

  // 发送消息（流式）
  const send = useCallback(async (userInput) => {
    if (!userInput.trim() || loading) return

    setError(null)
    setLoading(true)

    // 没有 session 就先创建
    if (!sessionIdRef.current) {
      await initSession()
    }

    // 立即把用户消息渲染到界面
    const userMsg = {
      id: Date.now(),
      role: 'user',
      content: userInput,
      time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    }
    setMessages(prev => [...prev, userMsg])

    // 开始流式请求
    setStreaming(true)
    setStreamContent('')

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch(`${API_BASE}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          message: userInput,
          systemPrompt,
        }),
        signal: controller.signal,
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer    = ''
      let fullReply = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() // 保留未完整的行

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (data.token) {
                fullReply += data.token
                setStreamContent(fullReply) // 实时更新流式内容
              }
            } catch {}
          }

          if (line === 'event: done') {
            // 流式完成：把临时内容转为正式消息
            const aiMsg = {
              id: Date.now() + 1,
              role: 'assistant',
              content: fullReply,
              time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
            }
            setMessages(prev => [...prev, aiMsg])
            setStreaming(false)
            setStreamContent('')
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message)
        setStreaming(false)
      }
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }, [loading, systemPrompt, initSession])

  // 取消正在进行的请求
  const cancel = useCallback(() => {
    abortRef.current?.abort()
    setStreaming(false)
    setLoading(false)
  }, [])

  // 清空会话
  const clearSession = useCallback(async () => {
    if (sessionIdRef.current) {
      await fetch(`${API_BASE}/api/sessions/${sessionIdRef.current}`, {
        method: 'DELETE',
      }).catch(() => {})
    }
    sessionIdRef.current = null
    setMessages([])
    setStreamContent('')
    setError(null)
  }, [])

  return {
    messages,
    loading,
    streaming,
    streamContent,
    error,
    send,
    cancel,
    clearSession,
    sessionId: sessionIdRef.current,
  }
}
