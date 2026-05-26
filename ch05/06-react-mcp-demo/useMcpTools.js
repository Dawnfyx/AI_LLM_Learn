// 06-react-mcp-demo/useMcpTools.js
// React Hook：管理 MCP 工具列表、连接状态、工具调用
import { useState, useEffect, useCallback } from 'react'

const API = 'http://localhost:3000'

export function useMcpTools() {
  const [tools, setTools]           = useState([])
  const [servers, setServers]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)

  // 加载工具和服务器列表
  useEffect(() => {
    async function load() {
      try {
        const [toolsRes, healthRes] = await Promise.all([
          fetch(`${API}/api/tools`),
          fetch(`${API}/health`),
        ])

        const { tools: rawTools } = await toolsRes.json()
        const { mcpServers, totalTools } = await healthRes.json()

        // 解析工具名前缀得到 server 来源
        setTools(rawTools.map(t => {
          const underscoreIdx = t.name.indexOf('_')
          const server = underscoreIdx > 0 ? t.name.slice(0, underscoreIdx) : 'builtin'
          const displayName = underscoreIdx > 0 ? t.name.slice(underscoreIdx + 1) : t.name
          return { ...t, server, displayName }
        }))

        setServers(mcpServers.map(name => ({ name, status: 'connected' })))
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [])

  // 调用单个工具
  const callTool = useCallback(async (toolName, args) => {
    const res = await fetch(`${API}/api/tool/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolName, args }),
    })
    return res.json()
  }, [])

  // 按 server 分组
  const toolsByServer = tools.reduce((acc, t) => {
    if (!acc[t.server]) acc[t.server] = []
    acc[t.server].push(t)
    return acc
  }, {})

  return { tools, servers, toolsByServer, loading, error, callTool }
}
