<!-- 06-vue-memory-app/MemoryChat.vue -->
<!-- 带长期记忆的聊天界面：左侧显示记忆面板，右侧聊天 -->
<template>
  <div class="memory-chat">
    <!-- 左侧：记忆面板 -->
    <aside class="memory-panel">
      <div class="panel-header">
        🧠 长期记忆
        <span class="badge">{{ memories.length }}</span>
      </div>

      <!-- 用户信息 -->
      <div class="user-info">
        <div class="user-avatar">{{ userName ? userName[0] : 'U' }}</div>
        <div class="user-detail">
          <div class="user-name">{{ userName || '未设置姓名' }}</div>
          <div class="user-meta">{{ sessionCount }} 次对话 · {{ memories.length }} 条记忆</div>
        </div>
      </div>

      <!-- 记忆列表 -->
      <div class="memory-list">
        <div v-if="memories.length === 0" class="empty-memories">
          <div>暂无记忆</div>
          <div class="hint">对话中提到的信息会自动记录</div>
        </div>

        <div
          v-for="(mem, idx) in sortedMemories"
          :key="idx"
          class="memory-item"
          :class="mem.category"
        >
          <div class="memory-header">
            <span class="category-tag" :class="mem.category">
              {{ categoryLabel(mem.category) }}
            </span>
            <span class="importance">{{ '★'.repeat(mem.importance) }}</span>
            <button class="delete-btn" @click="deleteMemory(idx)">×</button>
          </div>
          <div class="memory-content">{{ mem.content }}</div>
          <div v-if="mem.tags?.length" class="memory-tags">
            <span v-for="tag in mem.tags" :key="tag" class="tag">{{ tag }}</span>
          </div>
        </div>
      </div>
    </aside>

    <!-- 右侧：聊天区 -->
    <main class="chat-area">
      <!-- 个性化提示 -->
      <div v-if="hasPersonalization" class="personalization-banner">
        <span class="banner-icon">✨</span>
        已根据 {{ memories.length }} 条历史记忆个性化本次对话
      </div>

      <!-- 消息列表 -->
      <div class="messages" ref="messagesEl">
        <div v-if="messages.length === 0" class="empty-chat">
          <div class="empty-icon">🤖</div>
          <div>开始对话，我会记住你说的重要信息</div>
          <div class="empty-hint">每次对话结束后，关键信息会保存到左侧记忆面板</div>
        </div>

        <div v-for="msg in messages" :key="msg.id" class="message" :class="msg.role">
          <div class="bubble">{{ msg.content }}</div>
          <div class="msg-time">{{ msg.time }}</div>
        </div>

        <div v-if="streaming" class="message assistant">
          <div class="bubble">{{ streamContent }}<span class="cursor" /></div>
        </div>
      </div>

      <!-- 记忆提取提示 -->
      <div v-if="memoryExtracting" class="memory-notice">
        <span class="spinner" /> 正在提取记忆...
      </div>

      <!-- 输入区 -->
      <div class="input-area">
        <textarea
          v-model="input"
          @keydown.ctrl.enter="send"
          placeholder="输入消息... (Ctrl+Enter 发送)"
          rows="2"
        />
        <button @click="send" :disabled="loading || !input.trim()" class="btn-send">
          {{ loading ? '...' : '发送' }}
        </button>
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick } from 'vue'

const API = 'http://localhost:3000'
const USER_ID = 'demo_user_001'
const SESSION_ID = `session_${Date.now()}`

const memories = ref([])
const userName = ref('')
const sessionCount = ref(0)
const messages = ref([])
const input = ref('')
const loading = ref(false)
const streaming = ref(false)
const streamContent = ref('')
const hasPersonalization = ref(false)
const memoryExtracting = ref(false)
const messagesEl = ref(null)
let msgId = 0

const CATEGORY_LABELS = { preference: '偏好', fact: '背景', goal: '目标', event: '经历' }
const categoryLabel = (cat) => CATEGORY_LABELS[cat] || cat

const sortedMemories = computed(() =>
  [...memories.value].sort((a, b) => b.importance - a.importance)
)

async function loadUserData() {
  const res = await fetch(`${API}/api/users/${USER_ID}`)
  const data = await res.json()
  memories.value = data.memories || []
  userName.value = data.name || ''
  sessionCount.value = data.sessionCount || 0
}

async function deleteMemory(index) {
  await fetch(`${API}/api/users/${USER_ID}/memories/${index}`, { method: 'DELETE' })
  await loadUserData()
}

async function send() {
  if (!input.value.trim() || loading.value) return

  const msg = input.value.trim()
  input.value = ''
  loading.value = true
  messages.value.push({
    id: ++msgId, role: 'user', content: msg,
    time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
  })
  await scrollBottom()

  streaming.value = true
  streamContent.value = ''

  const res = await fetch(`${API}/api/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: USER_ID, sessionId: SESSION_ID, message: msg }),
  })

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = '', full = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n'); buffer = parts.pop() ?? ''
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
        if (event === 'memory_loaded') hasPersonalization.value = data.hasPersonalization
        if (event === 'token') { full += data.token; streamContent.value = full; await scrollBottom() }
        if (event === 'memories_extracted') { memoryExtracting.value = true; setTimeout(() => { memoryExtracting.value = false; loadUserData() }, 1500) }
        if (event === 'done') {
          messages.value.push({ id: ++msgId, role: 'assistant', content: full, time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) })
          streaming.value = false; streamContent.value = ''
          await scrollBottom()
        }
      } catch {}
    }
  }
  loading.value = false
}

async function scrollBottom() {
  await nextTick()
  if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight
}

onMounted(loadUserData)
</script>

<style scoped>
.memory-chat { display: flex; height: 100vh; font-family: -apple-system, sans-serif; }

.memory-panel { width: 280px; background: #fff; border-right: 1px solid #e5e7eb; display: flex; flex-direction: column; overflow: hidden; }
.panel-header { padding: 14px 16px; font-weight: 600; font-size: 14px; border-bottom: 1px solid #e5e7eb; display: flex; align-items: center; gap: 8px; }
.badge { font-size: 11px; background: #ede9fe; color: #6d28d9; padding: 2px 8px; border-radius: 10px; font-weight: 400; }

.user-info { padding: 14px 16px; display: flex; gap: 10px; border-bottom: 1px solid #f3f4f6; }
.user-avatar { width: 36px; height: 36px; border-radius: 50%; background: #4f46e5; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 15px; flex-shrink: 0; }
.user-name { font-size: 13px; font-weight: 500; }
.user-meta { font-size: 11px; color: #9ca3af; margin-top: 2px; }

.memory-list { flex: 1; overflow-y: auto; padding: 8px; }
.empty-memories { padding: 20px; text-align: center; color: #9ca3af; font-size: 13px; }
.empty-memories .hint { font-size: 11px; margin-top: 4px; }

.memory-item { padding: 10px 12px; border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 8px; background: #fafafa; }
.memory-item.preference { border-left: 3px solid #8b5cf6; }
.memory-item.fact        { border-left: 3px solid #3b82f6; }
.memory-item.goal        { border-left: 3px solid #f59e0b; }
.memory-item.event       { border-left: 3px solid #10b981; }
.memory-header { display: flex; align-items: center; gap: 6px; margin-bottom: 5px; }
.category-tag { font-size: 10px; padding: 1px 6px; border-radius: 8px; font-weight: 500; }
.category-tag.preference { background: #ede9fe; color: #7c3aed; }
.category-tag.fact        { background: #dbeafe; color: #1d4ed8; }
.category-tag.goal        { background: #fef3c7; color: #b45309; }
.category-tag.event       { background: #d1fae5; color: #065f46; }
.importance { font-size: 10px; color: #f59e0b; margin-left: auto; }
.delete-btn { background: none; border: none; color: #d1d5db; cursor: pointer; font-size: 14px; padding: 0 2px; }
.delete-btn:hover { color: #ef4444; }
.memory-content { font-size: 12px; color: #374151; line-height: 1.6; }
.memory-tags { margin-top: 5px; display: flex; gap: 4px; flex-wrap: wrap; }
.tag { font-size: 10px; background: #f3f4f6; padding: 1px 5px; border-radius: 4px; color: #6b7280; }

.chat-area { flex: 1; display: flex; flex-direction: column; background: #f8f9fa; overflow: hidden; }
.personalization-banner { padding: 8px 16px; background: #eff6ff; border-bottom: 1px solid #bfdbfe; font-size: 12px; color: #1d4ed8; display: flex; align-items: center; gap: 6px; }
.banner-icon { font-size: 14px; }
.messages { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 14px; }
.empty-chat { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #9ca3af; gap: 8px; }
.empty-icon { font-size: 40px; }
.empty-hint { font-size: 12px; }
.message { display: flex; flex-direction: column; }
.message.user { align-items: flex-end; }
.message.assistant { align-items: flex-start; }
.bubble { max-width: 75%; padding: 10px 14px; border-radius: 12px; font-size: 14px; line-height: 1.7; white-space: pre-wrap; }
.message.user .bubble { background: #4f46e5; color: #fff; border-radius: 12px 4px 12px 12px; }
.message.assistant .bubble { background: #fff; color: #1f2937; border: 1px solid #e5e7eb; border-radius: 4px 12px 12px 12px; }
.msg-time { font-size: 10px; color: #9ca3af; margin-top: 3px; padding: 0 4px; }
.cursor { display: inline-block; width: 2px; height: 1em; background: #374151; vertical-align: text-bottom; animation: blink .7s infinite; }
@keyframes blink { 0%,100%{opacity:1}50%{opacity:0} }
.memory-notice { padding: 8px 16px; background: #fefce8; border-top: 1px solid #fef9c3; font-size: 12px; color: #92400e; display: flex; align-items: center; gap: 6px; }
.spinner { width: 12px; height: 12px; border: 2px solid #fcd34d; border-top-color: #d97706; border-radius: 50%; animation: spin .7s linear infinite; display: inline-block; }
@keyframes spin { to { transform: rotate(360deg); } }
.input-area { padding: 12px 16px; background: #fff; border-top: 1px solid #e5e7eb; display: flex; gap: 10px; }
textarea { flex: 1; padding: 10px 14px; border: 1px solid #e5e7eb; border-radius: 8px; resize: none; font-size: 14px; font-family: inherit; outline: none; }
textarea:focus { border-color: #4f46e5; }
.btn-send { padding: 0 20px; background: #4f46e5; color: #fff; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; }
.btn-send:disabled { opacity: .45; }
</style>
