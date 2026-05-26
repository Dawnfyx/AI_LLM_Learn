// 06-react-agent-app/useAgent.js
// React Hook：封装 Agent 流式执行逻辑，追踪工具调用步骤
import { useState, useCallback, useRef } from 'react'

const API = 'http://localhost:3000'

export function useAgent() {
  const [messages, setMessages]     = useState([])
  const [steps, setSteps]           = useState([])        // 当前执行中的步骤
  const [streamContent, setStream]  = useState('')
  const [loading, setLoading]       = useState(false)
  const activeStepsRef              = useRef({})
  const msgIdRef                    = useRef(0)

  const send = useCallback(async (text) => {
    if (!text.trim() || loading) return

    setLoading(true)
    setSteps([])
    setStream('')
    activeStepsRef.current = {}

    const userMsgId = ++msgIdRef.current
    setMessages(prev => [...prev, { id: userMsgId, role: 'user', content: text }])

    try {
      const res = await fetch(`${API}/api/agent/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      })

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer    = ''
      let full      = ''
      let finalSteps = []

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

            if (event === 'tool_start') {
              const step = { name: data.name, args: data.args, status: 'running', startTime: Date.now() }
              activeStepsRef.current[data.name] = step
              setSteps(prev => {
                const updated = [...prev, step]
                finalSteps = updated
                return updated
              })
            }

            if (event === 'tool_end') {
              const step = activeStepsRef.current[data.name]
              if (step) {
                step.result = data.result
                step.status = 'done'
                step.duration = Date.now() - step.startTime
                setSteps(prev => {
                  const updated = prev.map(s => s.name === data.name && s.status === 'running'
                    ? { ...step } : s)
                  finalSteps = updated
                  return updated
                })
              }
            }

            if (event === 'token') {
              full += data.token
              setStream(full)
            }

            if (event === 'done') {
              const aiMsgId = ++msgIdRef.current
              setMessages(prev => [...prev, {
                id: aiMsgId, role: 'assistant',
                content: full, steps: finalSteps,
              }])
              setSteps([])
              setStream('')
            }
          } catch {}
        }
      }
    } finally {
      setLoading(false)
    }
  }, [loading])

  const clear = useCallback(() => {
    setMessages([])
    setSteps([])
    setStream('')
  }, [])

  return { messages, steps, streamContent, loading, send, clear }
}
