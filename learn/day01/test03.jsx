// StreamChat.jsx
import { useState } from 'react'

export default function StreamChat() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [loading, setLoading] = useState(false)

  async function send() {
    if (!input.trim() || loading) return
    setLoading(true)
    setOutput('')

    const res = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: input }),
    })

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

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
            if (data.token) setOutput(prev => prev + data.token)
          } catch {}
        }
        if (line === 'event: done') setLoading(false)
      }
    }

    setLoading(false)
  }

  return (
    <div>
      <textarea value={input} onChange={e => setInput(e.target.value)} rows={3} />
      <button onClick={send} disabled={loading}>
        {loading ? '生成中...' : '发送'}
      </button>
      <div>{output}</div>
    </div>
  )
}