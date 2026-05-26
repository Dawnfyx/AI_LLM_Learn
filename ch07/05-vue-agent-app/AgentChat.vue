<!-- 05-vue-agent-app/AgentChat.vue -->
<!-- Agent 对话界面：可视化展示思考步骤和工具调用过程 -->
<template>
  <div class="agent-chat">
    <!-- 消息列表 -->
    <div class="messages" ref="messagesEl">
      <div v-if="messages.length === 0" class="empty">
        <div class="empty-icon">🤖</div>
        <div>前端开发 Agent 助手</div>
        <div class="empty-sub">可以帮你查文档、分析代码、生成代码片段</div>
      </div>

      <div v-for="msg in messages" :key="msg.id" class="message-group">
        <!-- 用户消息 -->
        <div v-if="msg.role === 'user'" class="user-msg">
          {{ msg.content }}
        </div>

        <!-- Agent 回答（含步骤展示） -->
        <div v-else class="agent-msg">
          <!-- 工具调用步骤 -->
          <div v-if="msg.steps?.length" class="steps">
            <div
              v-for="(step, i) in msg.steps"
              :key="i"
              class="step"
              :class="step.status"
            >
              <div class="step-header">
                <span class="step-dot" :class="step.status" />
                <span class="step-tool">{{ step.name }}</span>
                <span v-if="step.duration" class="step-time">{{ step.duration }}ms</span>
                <span class="step-status-label" :class="step.status">
                  {{ step.status === 'running' ? '执行中' : '完成' }}
                </span>
              </div>

              <!-- 展开/收起参数和结果 -->
              <div v-if="step.args || step.result" class="step-detail">
                <div v-if="step.args" class="step-section">
                  <span class="step-section-label">入参</span>
                  <pre class="step-code">{{ formatJSON(step.args) }}</pre>
                </div>
                <div v-if="step.result" class="step-section">
                  <span class="step-section-label">出参</span>
                  <pre class="step-code result">{{ formatJSON(step.result) }}</pre>
                </div>
              </div>
            </div>
          </div>

          <!-- 最终回答 -->
          <div class="answer-bubble">
            {{ msg.content }}
            <span v-if="msg.streaming" class="cursor" />
          </div>
        </div>
      </div>

      <!-- 当前正在执行的步骤 -->
      <div v-if="currentSteps.length && loading" class="agent-msg">
        <div class="steps">
          <div
            v-for="(step, i) in currentSteps"
            :key="i"
            class="step"
            :class="step.status"
          >
            <div class="step-header">
              <span class="step-dot" :class="step.status" />
              <span class="step-tool">{{ step.name }}</span>
              <span class="step-status-label" :class="step.status">
                {{ step.status === 'running' ? '执行中' : '完成' }}
              </span>
            </div>
          </div>
        </div>
        <div v-if="streamContent" class="answer-bubble">
          {{ streamContent }}<span class="cursor" />
        </div>
      </div>
    </div>

    <!-- 输入区 -->
    <div class="input-area">
      <div class="quick-actions">
        <button
          v-for="action in quickActions"
          :key="action"
          class="quick-btn"
          @click="sendMessage(action)"
          :disabled="loading"
        >
          {{ action }}
        </button>
      </div>
      <div class="input-row">
        <textarea
          v-model="input"
          @keydown.ctrl.enter="sendMessage()"
          placeholder="输入问题... (Ctrl+Enter 发送)"
          rows="2"
        />
        <button @click="sendMessage()" :disabled="loading || !input.trim()" class="btn-send">
          {{ loading ? '...' : '发送' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick } from 'vue'

const API = 'http://localhost:3000'

const messages = ref([])
const input = ref('')
const loading = ref(false)
const streamContent = ref('')
const currentSteps = ref([])
const messagesEl = ref(null)
let msgId = 0

const quickActions = [
  'Vue3 v-model 怎么用？',
  '帮我生成一个 Vue3 数据获取 Composable',
  '分析这段代码：async function fetchData() { const res = await fetch("/api") }',
]

function formatJSON(data) {
  try {
    const obj = typeof data === 'string' ? JSON.parse(data) : data
    return JSON.stringify(obj, null, 2)
  } catch { return String(data) }
}

async function scrollBottom() {
  await nextTick()
  if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight
}

async function sendMessage(text) {
  const msg = (text || input.value).trim()
  if (!msg || loading.value) return

  input.value = ''
  loading.value = true
  currentSteps.value = []
  streamContent.value = ''

  messages.value.push({ id: ++msgId, role: 'user', content: msg })
  await scrollBottom()

  const activeSteps = {}  // toolName → step 对象

  const res = await fetch(`${API}/api/agent/stream`, {
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
          activeSteps[data.name] = step
          currentSteps.value = [...currentSteps.value, step]
        }

        if (event === 'tool_end') {
          const step = activeSteps[data.name]
          if (step) {
            step.result = data.result
            step.status = 'done'
            step.duration = Date.now() - step.startTime
            currentSteps.value = [...currentSteps.value]
          }
        }

        if (event === 'token') {
          full += data.token
          streamContent.value = full
          await scrollBottom()
        }

        if (event === 'done') {
          messages.value.push({
            id: ++msgId,
            role: 'assistant',
            content: full,
            steps: [...currentSteps.value],
            streaming: false,
          })
          currentSteps.value = []
          streamContent.value = ''
          await scrollBottom()
        }
      } catch {}
    }
  }

  loading.value = false
}
</script>

<style scoped>
.agent-chat { display: flex; flex-direction: column; height: 100vh; font-family: -apple-system, sans-serif; background: #f8f9fa; }

.messages { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 20px; }
.empty { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 8px; color: #9ca3af; }
.empty-icon { font-size: 48px; }
.empty-sub { font-size: 12px; }

.message-group { display: flex; flex-direction: column; gap: 8px; }
.user-msg { align-self: flex-end; max-width: 70%; padding: 10px 14px; background: #4f46e5; color: #fff; border-radius: 12px 4px 12px 12px; font-size: 14px; line-height: 1.7; }

.agent-msg { display: flex; flex-direction: column; gap: 8px; max-width: 85%; }

/* 步骤展示 */
.steps { display: flex; flex-direction: column; gap: 6px; }
.step { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; transition: border-color .2s; }
.step.running { border-color: #3b82f6; box-shadow: 0 0 0 3px #3b82f620; }
.step.done { border-color: #22c55e; }

.step-header { padding: 8px 12px; display: flex; align-items: center; gap: 8px; background: #fafafa; }
.step-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.step-dot.running { background: #3b82f6; animation: pulse 1s infinite; }
.step-dot.done { background: #22c55e; }
@keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(1.3)} }

.step-tool { font-family: monospace; font-size: 12px; font-weight: 600; color: #374151; flex: 1; }
.step-time { font-size: 10px; color: #9ca3af; }
.step-status-label { font-size: 10px; padding: 1px 7px; border-radius: 8px; }
.step-status-label.running { background: #eff6ff; color: #1d4ed8; }
.step-status-label.done { background: #f0fdf4; color: #15803d; }

.step-detail { padding: 8px 12px; border-top: 1px solid #f3f4f6; }
.step-section { margin-bottom: 6px; }
.step-section-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: #9ca3af; }
.step-code { margin: 3px 0 0; background: #f8f9fa; border: 1px solid #e5e7eb; border-radius: 4px; padding: 6px 8px; font-size: 11px; font-family: monospace; overflow-x: auto; max-height: 100px; overflow-y: auto; white-space: pre-wrap; }
.step-code.result { background: #f0fdf4; border-color: #bbf7d0; }

/* 最终回答 */
.answer-bubble { padding: 12px 16px; background: #fff; border: 1px solid #e5e7eb; border-radius: 4px 12px 12px 12px; font-size: 14px; line-height: 1.75; white-space: pre-wrap; color: #1f2937; }
.cursor { display: inline-block; width: 2px; height: 1em; background: #374151; vertical-align: text-bottom; animation: blink .7s infinite; }
@keyframes blink { 0%,100%{opacity:1}50%{opacity:0} }

/* 输入区 */
.input-area { border-top: 1px solid #e5e7eb; background: #fff; padding: 12px 16px; }
.quick-actions { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
.quick-btn { font-size: 11px; padding: 4px 10px; background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 12px; cursor: pointer; color: #374151; white-space: nowrap; }
.quick-btn:hover { background: #ede9fe; border-color: #c4b5fd; color: #4f46e5; }
.quick-btn:disabled { opacity: .45; }

.input-row { display: flex; gap: 10px; }
textarea { flex: 1; padding: 10px 14px; border: 1px solid #e5e7eb; border-radius: 8px; resize: none; font-size: 14px; font-family: inherit; outline: none; }
textarea:focus { border-color: #4f46e5; }
.btn-send { padding: 0 20px; background: #4f46e5; color: #fff; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; }
.btn-send:disabled { opacity: .45; }
</style>
