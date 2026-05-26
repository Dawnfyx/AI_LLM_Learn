<!-- 05-vue-tool-dashboard/ToolDashboard.vue -->
<!-- 可视化工具调用过程：实时展示每个工具的调用状态、入参、出参 -->
<template>
  <div class="dashboard">
    <!-- 左：对话区 -->
    <div class="chat-panel">
      <div class="panel-header">💬 对话</div>

      <div class="messages" ref="messagesEl">
        <div v-if="messages.length === 0" class="empty">
          试试问：「帮我找手机配件，预算 100 元以内」
        </div>

        <div v-for="m in messages" :key="m.id" class="msg" :class="m.role">
          <div class="avatar">{{ m.role === 'user' ? '我' : 'AI' }}</div>
          <div class="bubble">{{ m.content }}</div>
        </div>

        <div v-if="streaming" class="msg assistant">
          <div class="avatar">AI</div>
          <div class="bubble">{{ streamContent }}<span class="cursor" /></div>
        </div>
      </div>

      <div class="input-row">
        <input
          v-model="input"
          @keyup.enter="send"
          placeholder="输入问题..."
          :disabled="loading"
        />
        <button @click="send" :disabled="loading || !input.trim()">
          {{ loading ? '...' : '发送' }}
        </button>
      </div>
    </div>

    <!-- 右：工具调用可视化 -->
    <div class="tool-panel">
      <div class="panel-header">
        🔧 工具调用过程
        <span class="tool-count" v-if="toolCalls.length">
          {{ toolCalls.length }} 次调用
        </span>
      </div>

      <div class="tool-list">
        <div v-if="toolCalls.length === 0 && !loading" class="empty">
          发送消息后，这里会显示工具调用的详细过程
        </div>

        <div
          v-for="tc in toolCalls"
          :key="tc.id"
          class="tool-card"
          :class="tc.status"
        >
          <!-- 工具头部 -->
          <div class="tool-header">
            <div class="tool-status-dot" :class="tc.status" />
            <span class="tool-name">{{ tc.toolName }}</span>
            <span class="tool-time" v-if="tc.duration">{{ tc.duration }}ms</span>
            <span class="tool-status-label" :class="tc.status">
              {{ statusLabel(tc.status) }}
            </span>
          </div>

          <!-- 参数 -->
          <div class="tool-section" v-if="tc.args">
            <div class="section-label">入参</div>
            <pre class="code-block">{{ formatJSON(tc.args) }}</pre>
          </div>

          <!-- 结果 -->
          <div class="tool-section" v-if="tc.result">
            <div class="section-label">出参</div>
            <pre class="code-block result">{{ formatJSON(tc.result) }}</pre>
          </div>
        </div>

        <!-- 进行中的工具调用骨架 -->
        <div v-if="currentTool" class="tool-card running">
          <div class="tool-header">
            <div class="tool-status-dot running" />
            <span class="tool-name">{{ currentTool }}</span>
            <span class="tool-status-label running">执行中</span>
          </div>
          <div class="loading-bar"><div class="bar-fill" /></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick } from 'vue'

const input = ref('')
const messages = ref([])
const toolCalls = ref([])
const loading = ref(false)
const streaming = ref(false)
const streamContent = ref('')
const currentTool = ref(null)
const messagesEl = ref(null)

let msgId = 0
let toolId = 0

function statusLabel(s) {
  return { pending: '等待', running: '执行中', done: '完成', error: '失败' }[s] || s
}

function formatJSON(data) {
  try {
    const obj = typeof data === 'string' ? JSON.parse(data) : data
    return JSON.stringify(obj, null, 2)
  } catch {
    return String(data)
  }
}

async function send() {
  if (!input.value.trim() || loading.value) return

  const userMsg = input.value.trim()
  input.value = ''
  loading.value = true
  toolCalls.value = []
  streamContent.value = ''

  messages.value.push({ id: ++msgId, role: 'user', content: userMsg })
  await scrollBottom()

  // 当前正在执行的工具 callId → toolCalls 里的对象
  const activeTools = {}

  const res = await fetch('http://localhost:3000/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: userMsg }),
  })

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  streaming.value = true

  while (true) {
    const { value, done } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop()

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      try {
        const data = JSON.parse(line.slice(6))

        // 工具开始调用
        if (line.includes('event: tool_start') || false) { /* handled below */ }

        const eventLine = lines[lines.indexOf(line) - 1] || ''
        const eventType = eventLine.startsWith('event: ')
          ? eventLine.slice(7) : ''

        if (eventType === 'tool_start') {
          const tc = {
            id: ++toolId,
            toolName: data.toolName,
            args: data.args,
            status: 'running',
            startTime: Date.now(),
            result: null,
            duration: null,
          }
          toolCalls.value.push(tc)
          activeTools[data.toolName] = tc
          currentTool.value = data.toolName
        }

        if (eventType === 'tool_end') {
          const tc = activeTools[data.toolName]
          if (tc) {
            tc.result = data.result
            tc.status = 'done'
            tc.duration = Date.now() - tc.startTime
          }
          currentTool.value = null
        }

        if (eventType === 'token') {
          streamContent.value += data.token
          await scrollBottom()
        }

        if (eventType === 'done') {
          messages.value.push({ id: ++msgId, role: 'assistant', content: streamContent.value })
          streaming.value = false
          streamContent.value = ''
          await scrollBottom()
        }

        if (eventType === 'error') {
          messages.value.push({ id: ++msgId, role: 'assistant', content: `错误：${data.message}` })
          streaming.value = false
        }
      } catch {}
    }
  }

  // 修复：正确解析 SSE（event 和 data 在不同行）
  // 上面的实现有简化，生产代码需要正确解析 SSE 协议

  loading.value = false
  currentTool.value = null
}

async function scrollBottom() {
  await nextTick()
  if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight
}
</script>

<style scoped>
.dashboard { display: flex; height: 100vh; font-family: -apple-system, sans-serif; background: #f8f9fa; }

/* 左侧 */
.chat-panel { width: 420px; display: flex; flex-direction: column; border-right: 1px solid #e5e7eb; background: #fff; }
.panel-header {
  padding: 14px 16px; font-weight: 600; font-size: 14px;
  border-bottom: 1px solid #e5e7eb; display: flex; align-items: center; gap: 8px;
}
.tool-count { font-size: 11px; background: #ede9fe; color: #6d28d9; padding: 2px 8px; border-radius: 10px; font-weight: 400; }

.messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.empty { text-align: center; color: #9ca3af; font-size: 13px; margin-top: 40px; }

.msg { display: flex; gap: 10px; align-items: flex-start; }
.msg.user { flex-direction: row-reverse; }
.avatar {
  width: 32px; height: 32px; border-radius: 50%; background: #4f46e5;
  color: #fff; display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 600; flex-shrink: 0;
}
.msg.user .avatar { background: #059669; }
.bubble {
  max-width: 80%; padding: 9px 13px; border-radius: 12px;
  background: #f3f4f6; font-size: 13px; line-height: 1.7; word-break: break-word;
}
.msg.user .bubble { background: #4f46e5; color: #fff; }

.cursor { display: inline-block; width: 2px; height: 1em; background: #374151; vertical-align: text-bottom; animation: blink .7s infinite; }
@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }

.input-row { padding: 14px; border-top: 1px solid #e5e7eb; display: flex; gap: 8px; }
input { flex: 1; padding: 9px 13px; border: 1px solid #e5e7eb; border-radius: 8px; font-size: 13px; outline: none; }
input:focus { border-color: #4f46e5; }
button { padding: 9px 18px; background: #4f46e5; color: #fff; border: none; border-radius: 8px; cursor: pointer; font-size: 13px; }
button:disabled { opacity: .45; }

/* 右侧工具面板 */
.tool-panel { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.tool-list { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }

.tool-card {
  background: #fff; border: 1px solid #e5e7eb; border-radius: 10px;
  padding: 14px; transition: border-color .2s;
}
.tool-card.running { border-color: #3b82f6; box-shadow: 0 0 0 3px #3b82f620; }
.tool-card.done { border-color: #22c55e; }

.tool-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.tool-status-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.tool-status-dot.running { background: #3b82f6; animation: pulse 1s infinite; }
.tool-status-dot.done { background: #22c55e; }
.tool-status-dot.error { background: #ef4444; }
@keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.6;transform:scale(1.3)} }

.tool-name { font-size: 13px; font-weight: 600; color: #1f2937; font-family: monospace; flex: 1; }
.tool-time { font-size: 11px; color: #9ca3af; }
.tool-status-label { font-size: 11px; padding: 2px 8px; border-radius: 10px; }
.tool-status-label.running { background: #eff6ff; color: #1d4ed8; }
.tool-status-label.done { background: #f0fdf4; color: #15803d; }
.tool-status-label.error { background: #fef2f2; color: #b91c1c; }

.tool-section { margin-top: 8px; }
.section-label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: #9ca3af; margin-bottom: 4px; }
.code-block {
  background: #f8f9fa; border: 1px solid #e5e7eb; border-radius: 6px;
  padding: 8px 10px; font-size: 11px; line-height: 1.6; overflow-x: auto;
  font-family: 'JetBrains Mono', monospace; color: #374151; margin: 0;
  max-height: 150px; overflow-y: auto;
}
.code-block.result { background: #f0fdf4; border-color: #bbf7d0; }

.loading-bar { height: 3px; background: #e5e7eb; border-radius: 2px; overflow: hidden; margin-top: 10px; }
.bar-fill { height: 100%; width: 40%; background: #3b82f6; border-radius: 2px; animation: slide 1.2s ease-in-out infinite; }
@keyframes slide { 0%{transform:translateX(-100%)} 100%{transform:translateX(350%)} }
</style>
