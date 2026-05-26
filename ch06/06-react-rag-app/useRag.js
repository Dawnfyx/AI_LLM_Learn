// 06-react-rag-app/useRag.js
// React RAG Hook：封装文档管理和问答逻辑
import { useState, useCallback } from 'react'

const API = 'http://localhost:3000'

export function useRag() {
  const [documents, setDocuments]   = useState([])
  const [messages, setMessages]     = useState([])
  const [loading, setLoading]       = useState(false)
  const [uploading, setUploading]   = useState(false)
  const [statusMsg, setStatusMsg]   = useState('')

  // 加载文档列表
  const loadDocuments = useCallback(async () => {
    const res = await fetch(`${API}/api/documents`)
    const { documents } = await res.json()
    setDocuments(documents)
  }, [])

  // 上传文档
  const uploadDocument = useCallback(async ({ title, category, content }) => {
    setUploading(true)
    try {
      const res = await fetch(`${API}/api/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, category, content }),
      })
      const data = await res.json()
      if (data.success) await loadDocuments()
      return data
    } finally {
      setUploading(false)
    }
  }, [loadDocuments])

  // 删除文档
  const deleteDocument = useCallback(async (docId) => {
    await fetch(`${API}/api/documents/${docId}`, { method: 'DELETE' })
    await loadDocuments()
  }, [loadDocuments])

  // 提问（流式）
  const ask = useCallback(async (question, category) => {
    if (!question.trim() || loading) return

    setLoading(true)
    let msgId = Date.now()

    // 添加用户消息
    setMessages(prev => [...prev, { id: msgId++, role: 'user', content: question }])

    // 创建 AI 消息占位
    const aiMsgId = msgId++
    setMessages(prev => [...prev, {
      id: aiMsgId, role: 'assistant',
      content: '', sources: [], streaming: true,
    }])

    try {
      const res = await fetch(`${API}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, category: category || undefined }),
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

            if (event === 'status') setStatusMsg(data.message)

            if (event === 'sources') {
              setStatusMsg('')
              setMessages(prev => prev.map(m =>
                m.id === aiMsgId ? { ...m, sources: data.sources } : m
              ))
            }

            if (event === 'token') {
              setMessages(prev => prev.map(m =>
                m.id === aiMsgId ? { ...m, content: m.content + data.token } : m
              ))
            }

            if (event === 'done') {
              setMessages(prev => prev.map(m =>
                m.id === aiMsgId ? { ...m, streaming: false } : m
              ))
              setStatusMsg('')
            }
          } catch {}
        }
      }
    } finally {
      setLoading(false)
      setMessages(prev => prev.map(m =>
        m.id === aiMsgId ? { ...m, streaming: false } : m
      ))
    }
  }, [loading])

  return {
    documents, messages, loading, uploading, statusMsg,
    loadDocuments, uploadDocument, deleteDocument, ask,
  }
}
