<!-- 05-vue-mcp-demo/McpToolsPanel.vue -->
<!-- Vue3 组件：展示已连接的 MCP Server 列表和可用工具，支持手动调用测试 -->
<template>
  <div class="mcp-panel">
    <!-- 左：服务器和工具列表 -->
    <aside class="sidebar">
      <div class="sidebar-title">
        <span>MCP 工具库</span>
        <span class="badge">{{ tools.length }} 个工具</span>
      </div>

      <div v-if="loading" class="loading">连接 MCP Server...</div>

      <div v-else>
        <!-- 工具分组（按 server 名前缀分组） -->
        <div v-for="group in toolGroups" :key="group.server" class="tool-group">
          <div class="group-header">
            <span class="server-dot" :class="group.status" />
            <span class="group-name">{{ group.server }}</span>
            <span class="group-count">{{ group.tools.length }}</span>
          </div>

          <div
            v-for="t in group.tools"
            :key="t.name"
            class="tool-item"
            :class="{ active: selectedTool?.name === t.name }"
            @click="selectTool(t)"
          >
            <span class="tool-icon">🔧</span>
            <div class="tool-info">
              <div class="tool-name">{{ t.displayName }}</div>
              <div class="tool-desc">{{ t.description.slice(0, 50) }}...</div>
            </div>
          </div>
        </div>
      </div>
    </aside>

    <!-- 右：工具详情和测试 -->
    <main class="main-content">
      <div v-if="!selectedTool" class="placeholder">
        <div class="placeholder-icon">🔌</div>
        <div>选择左侧的工具查看详情</div>
        <div class="placeholder-sub">或者直接在下方对话框里提问</div>
      </div>

      <template v-else>
        <!-- 工具详情 -->
        <div class="tool-detail">
          <div class="detail-header">
            <h2>{{ selectedTool.displayName }}</h2>
            <span class="server-tag">{{ selectedTool.server }}</span>
          </div>
          <p class="detail-desc">{{ selectedTool.description }}</p>

          <!-- 参数表单 -->
          <div class="params-form">
            <div class="form-title">测试工具</div>

            <div v-for="(param, key) in selectedTool.params" :key="key" class="form-field">
              <label>
                {{ key }}
                <span v-if="param.required" class="required">*</span>
                <span class="param-type">{{ param.type }}</span>
              </label>
              <div class="param-desc">{{ param.description }}</div>

              <select v-if="param.enum" v-model="formValues[key]">
                <option v-for="opt in param.enum" :key="opt" :value="opt">{{ opt }}</option>
              </select>
              <textarea
                v-else-if="param.type === 'string' && key === 'code'"
                v-model="formValues[key]"
                rows="5"
                :placeholder="param.description"
              />
              <input v-else v-model="formValues[key]" :placeholder="param.description" />
            </div>

            <button @click="callTool" :disabled="calling">
              {{ calling ? '调用中...' : '▶ 调用工具' }}
            </button>
          </div>

          <!-- 工具调用结果 -->
          <div v-if="toolResult" class="result-block">
            <div class="result-header">
              <span>执行结果</span>
              <span class="result-time">耗时 {{ toolResult.duration }}ms</span>
            </div>
            <pre class="result-content">{{ formatResult(toolResult.data) }}</pre>
          </div>
        </div>
      </template>

      <!-- 底部：AI 对话（使用所有 MCP 工具） -->
      <div class="chat-section">
        <div class="chat-title">💬 AI 对话（可使用所有工具）</div>

        <div class="messages" ref="messagesEl">
          <div v-for="m in messages" :key="m.id" class="msg" :class="m.role">
            <div class="msg-content">{{ m.content }}</div>
          </div>
          <div v-if="streaming" class="msg assistant">
            <div class="msg-content">{{ streamContent }}<span class="cursor" /></div>
          </div>
        </div>

        <div class="chat-input">
          <input
            v-model="chatInput"
            @keyup.enter="sendChat"
            placeholder="提问，AI 会自动选择合适的 MCP 工具..."
            :disabled="chatLoading"
          />
          <button @click="sendChat" :disabled="chatLoading || !chatInput.trim()">发送</button>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick } from 'vue'

const API = 'http://localhost:3000'

const tools = ref([])
const loading = ref(true)
const selectedTool = ref(null)
const formValues = ref({})
const calling = ref(false)
const toolResult = ref(null)
const messages = ref([])
const chatInput = ref('')
const chatLoading = ref(false)
const streaming = ref(false)
const streamContent = ref('')
const messagesEl = ref(null)

let msgId = 0

// 按 server 分组
const toolGroups = computed(() => {
  const groups = {}
  for (const t of tools.value) {
    if (!groups[t.server]) {
      groups[t.server] = { server: t.server, tools: [], status: 'connected' }
    }
    groups[t.server].tools.push(t)
  }
  return Object.values(groups)
})

// 加载工具列表
async function loadTools() {
  try {
    const res = await fetch(`${API}/api/tools`)
    const data = await res.json()

    // 解析工具名：serverName_toolName
    tools.value = data.tools.map(t => {
      const [server, ...rest] = t.name.split('_')
      return {
        ...t,
        server,
        displayName: rest.join('_'),
        params: {},  // 实际项目从 schema 解析
      }
    })
  } catch (e) {
    console.error('加载工具失败：', e.message)
  } finally {
    loading.value = false
  }
}

function selectTool(t) {
  selectedTool.value = t
  formValues.value = {}
  toolResult.value = null
}

async function callTool() {
  if (!selectedTool.value) return
  calling.value = true
  toolResult.value = null

  const start = Date.now()
  try {
    const res = await fetch(`${API}/api/tool/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toolName: selectedTool.value.name,
        args: formValues.value,
      }),
    })
    const data = await res.json()
    toolResult.value = { data, duration: Date.now() - start }
  } catch (e) {
    toolResult.value = { data: { error: e.message }, duration: Date.now() - start }
  } finally {
    calling.value = false
  }
}

async function sendChat() {
  if (!chatInput.value.trim() || chatLoading.value) return

  const msg = chatInput.value.trim()
  chatInput.value = ''
  chatLoading.value = true
  messages.value.push({ id: ++msgId, role: 'user', content: msg })
  await scrollBottom()

  streaming.value = true
  streamContent.value = ''

  const res = await fetch(`${API}/api/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: msg }),
  })

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

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
        if (event === 'token') {
          streamContent.value += data.token
          await scrollBottom()
        }
        if (event === 'done') {
          messages.value.push({ id: ++msgId, role: 'assistant', content: streamContent.value })
          streaming.value = false
          streamContent.value = ''
        }
      } catch {}
    }
  }

  chatLoading.value = false
  await scrollBottom()
}

function formatResult(data) {
  try {
    return JSON.stringify(typeof data === 'string' ? JSON.parse(data) : data, null, 2)
  } catch {
    return String(data)
  }
}

async function scrollBottom() {
  await nextTick()
  if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight
}

onMounted(loadTools)
</script>

<style scoped>
.mcp-panel { display: flex; height: 100vh; font-family: -apple-system, sans-serif; font-size: 14px; }

.sidebar { width: 260px; border-right: 1px solid #e5e7eb; background: #f9fafb; display: flex; flex-direction: column; overflow-y: auto; }
.sidebar-title { padding: 14px 16px; font-weight: 600; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; }
.badge { font-size: 11px; background: #ede9fe; color: #6d28d9; padding: 2px 8px; border-radius: 10px; font-weight: 400; }
.loading { padding: 20px 16px; color: #9ca3af; font-size: 13px; }

.tool-group { padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
.group-header { padding: 6px 16px; display: flex; align-items: center; gap: 8px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: #9ca3af; }
.server-dot { width: 6px; height: 6px; border-radius: 50%; background: #22c55e; }
.group-count { margin-left: auto; background: #e5e7eb; padding: 1px 6px; border-radius: 8px; }

.tool-item { padding: 8px 16px; display: flex; gap: 8px; cursor: pointer; }
.tool-item:hover, .tool-item.active { background: #ede9fe; }
.tool-icon { font-size: 14px; flex-shrink: 0; }
.tool-name { font-size: 12px; font-weight: 500; color: #374151; font-family: monospace; }
.tool-desc { font-size: 11px; color: #9ca3af; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.main-content { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

.placeholder { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #9ca3af; gap: 8px; }
.placeholder-icon { font-size: 40px; }
.placeholder-sub { font-size: 12px; }

.tool-detail { padding: 20px; border-bottom: 1px solid #e5e7eb; overflow-y: auto; max-height: 60%; }
.detail-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.detail-header h2 { font-size: 16px; font-weight: 600; margin: 0; font-family: monospace; }
.server-tag { font-size: 11px; background: #e0e7ff; color: #4338ca; padding: 2px 8px; border-radius: 4px; }
.detail-desc { color: #6b7280; font-size: 13px; margin-bottom: 16px; line-height: 1.6; }

.params-form { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px; }
.form-title { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: #9ca3af; margin-bottom: 12px; }
.form-field { margin-bottom: 12px; }
.form-field label { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 500; margin-bottom: 4px; }
.required { color: #ef4444; }
.param-type { font-size: 10px; background: #f3f4f6; padding: 1px 5px; border-radius: 3px; color: #6b7280; font-family: monospace; }
.param-desc { font-size: 11px; color: #9ca3af; margin-bottom: 5px; }
.form-field input, .form-field select, .form-field textarea { width: 100%; padding: 7px 10px; border: 1px solid #e5e7eb; border-radius: 6px; font-size: 13px; box-sizing: border-box; font-family: monospace; }
button { padding: 8px 20px; background: #4f46e5; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; margin-top: 8px; }
button:disabled { opacity: .45; cursor: not-allowed; }

.result-block { margin-top: 14px; }
.result-header { display: flex; justify-content: space-between; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: #9ca3af; margin-bottom: 6px; }
.result-time { color: #22c55e; }
.result-content { background: #1e1e1e; color: #d4d4d4; padding: 12px; border-radius: 8px; font-size: 12px; font-family: monospace; overflow-x: auto; margin: 0; max-height: 200px; overflow-y: auto; }

.chat-section { flex: 1; display: flex; flex-direction: column; border-top: 1px solid #e5e7eb; min-height: 200px; }
.chat-title { padding: 10px 16px; font-size: 13px; font-weight: 500; border-bottom: 1px solid #f3f4f6; }
.messages { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.msg { max-width: 80%; }
.msg.user { align-self: flex-end; }
.msg-content { padding: 8px 12px; border-radius: 10px; font-size: 13px; line-height: 1.6; background: #f3f4f6; }
.msg.user .msg-content { background: #4f46e5; color: #fff; }
.cursor { display: inline-block; width: 2px; height: 1em; background: #374151; vertical-align: text-bottom; animation: blink .7s infinite; }
@keyframes blink { 0%,100%{opacity:1}50%{opacity:0} }
.chat-input { padding: 12px; border-top: 1px solid #e5e7eb; display: flex; gap: 8px; }
.chat-input input { flex: 1; padding: 8px 12px; border: 1px solid #e5e7eb; border-radius: 8px; font-size: 13px; outline: none; }
.chat-input button { padding: 8px 16px; }
</style>
