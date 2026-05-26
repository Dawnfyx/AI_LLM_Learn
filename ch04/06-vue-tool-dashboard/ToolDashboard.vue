<!-- 06-vue-tool-dashboard/ToolDashboard.vue -->
<!-- 可视化展示 Function Call 的完整过程：工具调用、参数、结果、流式回复 -->
<template>
  <div class="dashboard">
    <!-- 左：对话区 -->
    <div class="chat-panel">
      <div class="panel-header">对话</div>

      <div class="messages" ref="msgEl">
        <div v-if="!messages.length" class="empty">试试问：北京今天天气？或查一下 vue 的版本</div>

        <div v-for="m in messages" :key="m.id" class="message" :class="m.role">
          <div class="bubble">{{ m.content }}</div>
        </div>

        <div v-if="streaming" class="message assistant">
          <div class="bubble streaming">{{ streamContent }}<span class="cursor" /></div>
        </div>
      </div>

      <div class="input-row">
        <input
          v-model="input"
          placeholder="输入问题..."
          @keyup.enter="send"
          :disabled="loading"
        />
        <button @click="send" :disabled="loading || !input.trim()">
          {{ loading ? '...' : '发送' }}
        </button>
      </div>
    </div>

    <!-- 右：工具调用过程 -->
    <div class="tool-panel">
      <div class="panel-header">
        工具调用过程
        <span class="clear-btn" @click="toolLogs = []">清空</span>
      </div>

      <div class="tool-logs" ref="logEl">
        <div v-if="!toolLogs.length" class="empty">工具调用记录将显示在这里</div>

        <div v-for="log in toolLogs" :key="log.id" class="log-item" :class="log.type">
          <div class="log-header">
            <span class="log-icon">{{ logIcon(log.type) }}</span>
            <span class="log-tool">{{ log.tool }}</span>
            <span class="log-time">{{ log.time }}</span>
          </div>

          <!-- 工具调用开始：显示参数 -->
          <div v-if="log.type === 'tool_start' && log.args" class="log-body">
            <div class="log-label">参数：</div>
            <pre>{{ JSON.stringify(log.args, null, 2) }}</pre>
          </div>

          <!-- 工具调用结束：显示结果 -->
          <div v-if="log.type === 'tool_end' && log.result" class="log-body">
            <div class="log-label">返回：</div>
            <pre>{{ formatResult(log.result) }}</pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick } from 'vue'

const input = ref('')
const messages = ref([])
const toolLogs = ref([])
const loading = ref(false)
const streaming = ref(false)
const streamContent = ref('')
const msgEl = ref(null)
const logEl = ref(null)

let idCounter = 0
const nextId = () => ++idCounter

function formatTime() {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function logIcon(type) {
  return { tool_start: '⚡', tool_end: '✓', error: '✗' }[type] || '•'
}

function formatResult(result) {
  try {
    return JSON.stringify(JSON.parse(result), null, 2)
  } catch {
    return String(result).slice(0, 200)
  }
}

async function scrollBottom(el) {
  await nextTick()
  if (el.value) el.value.scrollTop = el.value.scrollHeight
}

async function send() {
  if (!input.value.trim() || loading.value) return
  const msg = input.value.trim()
  input.value = ''
  loading.value = true

  messages.value.push({ id: nextId(), role: 'user', content: msg })
  await scrollBottom(msgEl)

  streaming.value = true
  streamContent.value = ''

  try {
    const res = await fetch('http://localhost:3000/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg }),
    })

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let full = ''

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

          // 根据事件类型处理
          const eventLine = lines[lines.indexOf(line) - 1] || ''
          const eventType = eventLine.replace('event: ', '')

          if (eventType === 'tool_start') {
            toolLogs.value.push({
              id: nextId(), type: 'tool_start',
              tool: data.tool, args: data.args,
              time: formatTime(),
            })
            await scrollBottom(logEl)
          }

          if (eventType === 'tool_end') {
            toolLogs.value.push({
              id: nextId(), type: 'tool_end',
              tool: data.tool, result: data.result,
              time: formatTime(),
            })
            await scrollBottom(logEl)
          }

          if (eventType === 'token' && data.token) {
            full += data.token
            streamContent.value = full
            await scrollBottom(msgEl)
          }

          if (eventType === 'done') {
            messages.value.push({ id: nextId(), role: 'assistant', content: full })
            streaming.value = false
            streamContent.value = ''
          }
        } catch {}
      }
    }
  } catch (err) {
    messages.value.push({ id: nextId(), role: 'assistant', content: `错误：${err.message}` })
  } finally {
    loading.value = false
    streaming.value = false
    await scrollBottom(msgEl)
  }
}
</script>

<style scoped>
.dashboard { display: grid; grid-template-columns: 1fr 1fr; height: 100vh; font-family: sans-serif; }
.chat-panel, .tool-panel { display: flex; flex-direction: column; border-right: 1px solid #e5e7eb; }
.panel-header {
  padding: 14px 16px; font-weight: 600; font-size: 14px;
  border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between;
}
.clear-btn { font-size: 12px; color: #9ca3af; cursor: pointer; font-weight: 400; }
.messages, .tool-logs { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
.empty { color: #9ca3af; font-size: 13px; text-align: center; margin-top: 30px; }
.message { display: flex; }
.message.user { justify-content: flex-end; }
.bubble {
  max-width: 80%; padding: 9px 13px; border-radius: 10px; font-size: 14px; line-height: 1.6;
  background: #f3f4f6; color: #374151;
}
.message.user .bubble { background: #4f46e5; color: #fff; }
.cursor { display: inline-block; width: 2px; height: 1em; background: #374151; animation: blink .7s infinite; vertical-align: text-bottom; }
@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }

.input-row { padding: 12px 16px; border-top: 1px solid #e5e7eb; display: flex; gap: 8px; }
input { flex: 1; padding: 8px 12px; border: 1px solid #e5e7eb; border-radius: 6px; font-size: 14px; }
button { padding: 8px 16px; background: #4f46e5; color: #fff; border: none; border-radius: 6px; cursor: pointer; }
button:disabled { opacity: .5; }

.log-item { border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; font-size: 12px; }
.log-item.tool_start { border-color: #bfdbfe; }
.log-item.tool_end { border-color: #bbf7d0; }
.log-header { padding: 8px 12px; display: flex; align-items: center; gap: 8px; background: #f9fafb; }
.log-item.tool_start .log-header { background: #eff6ff; }
.log-item.tool_end .log-header { background: #f0fdf4; }
.log-icon { font-size: 14px; }
.log-tool { font-weight: 600; color: #374151; flex: 1; }
.log-time { color: #9ca3af; }
.log-body { padding: 10px 12px; background: #fff; }
.log-label { font-size: 11px; color: #9ca3af; margin-bottom: 4px; }
pre { margin: 0; font-size: 11px; color: #374151; white-space: pre-wrap; word-break: break-all; }
</style>
