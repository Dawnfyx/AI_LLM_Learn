<!-- 05-vue-memory-app/MemoryChat.vue -->
<!-- 带记忆系统的聊天界面：展示用户画像 + 触发的历史记忆 -->
<template>
  <div class="memory-chat">
    <!-- 左：用户画像面板 -->
    <aside class="profile-panel">
      <div class="panel-header">
        <span>👤 用户画像</span>
        <button class="btn-refresh" @click="loadProfile" title="刷新画像">↻</button>
      </div>

      <div v-if="!profile || Object.keys(profile).length === 0" class="empty-profile">
        和 AI 多聊几句，它会自动学习你的偏好
      </div>
      <div v-else class="profile-items">
        <div v-if="profile.name" class="profile-row">
          <span class="p-label">姓名</span>
          <span class="p-val">{{ profile.name }}</span>
        </div>
        <div v-if="profile.techLevel" class="profile-row">
          <span class="p-label">水平</span>
          <span class="p-val p-badge" :class="profile.techLevel">{{ techLevelText }}</span>
        </div>
        <div v-if="profile.techStack?.length" class="profile-row">
          <span class="p-label">技术栈</span>
          <div class="p-tags">
            <span v-for="t in profile.techStack" :key="t" class="p-tag">{{ t }}</span>
          </div>
        </div>
        <div v-if="profile.currentGoal" class="profile-row">
          <span class="p-label">目标</span>
          <span class="p-val">{{ profile.currentGoal }}</span>
        </div>
        <div v-if="profile.knownTopics?.length" class="profile-row">
          <span class="p-label">已掌握</span>
          <div class="p-tags">
            <span v-for="t in profile.knownTopics.slice(0, 5)" :key="t" class="p-tag green">{{ t }}</span>
          </div>
        </div>
      </div>

      <!-- 记忆清除 -->
      <div class="profile-footer">
        <button class="btn-clear" @click="clearMemory">🗑 清除记忆</button>
      </div>
    </aside>

    <!-- 中：对话区 -->
    <main class="chat-main">
      <div class="messages" ref="messagesEl">
        <div v-if="messages.length === 0" class="empty-chat">
          <div class="empty-icon">🧠</div>
          <div>我会记住你的每次对话</div>
          <div class="empty-sub">每次聊天结束，重要信息会自动存入长期记忆</div>
        </div>

        <div v-for="msg in messages" :key="msg.id" class="message-wrap">
          <!-- 记忆提示（AI 引用了历史记忆时） -->
          <div v-if="msg.role === 'assistant' && msg.memories?.length" class="memory-hint">
            <span class="memory-icon">💡</span>
            <span>引用了 {{ msg.memories.length }} 条历史记忆</span>
            <div class="memory-list">
              <div v-for="m in msg.memories" :key="m" class="memory-item">{{ m }}</div>
            </div>
          </div>

          <div class="message" :class="msg.role">
            <div class="avatar">{{ msg.role === 'user' ? '我' : 'AI' }}</div>
            <div class="bubble">
              {{ msg.content }}
              <span v-if="msg.streaming" class="cursor" />
            </div>
          </div>
        </div>
      </div>

      <!-- 输入区 -->
      <div class="input-area">
        <!-- 用户 ID（区分用户，演示用） -->
        <div class="user-id-bar">
          <span class="id-label">用户 ID：</span>
          <input v-model="userId" class="id-input" placeholder="user-001" />
          <span class="id-hint">（用于区分不同用户的记忆）</span>
        </div>
        <div class="input-row">
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
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick } from 'vue'

const API = 'http://localhost:3000'

const userId = ref('user-demo')
const input = ref('')
const messages = ref([])
const profile = ref({})
const loading = ref(false)
const messagesEl = ref(null)
let msgId = 0

const techLevelText = computed(() => {
  const map = { beginner: '初级', intermediate: '中级', senior: '资深' }
  return map[profile.value.techLevel] || profile.value.techLevel
})

onMounted(() => loadProfile())

async function loadProfile() {
  try {
    const res = await fetch(`${API}/api/profile/${userId.value}`)
    profile.value = await res.json()
  } catch {}
}

async function clearMemory() {
  if (!confirm('确定清除所有记忆和画像？')) return
  await fetch(`${API}/api/memories/${userId.value}`, { method: 'DELETE' })
  profile.value = {}
  messages.value = []
}

async function scrollBottom() {
  await nextTick()
  if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight
}

async function send() {
  if (!input.value.trim() || loading.value) return

  const msg = input.value.trim()
  input.value = ''
  loading.value = true

  messages.value.push({ id: ++msgId, role: 'user', content: msg })
  await scrollBottom()

  const aiMsg = { id: ++msgId, role: 'assistant', content: '', memories: [], streaming: true }
  messages.value.push(aiMsg)

  const res = await fetch(`${API}/api/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: userId.value, message: msg }),
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
        if (event === 'memories') aiMsg.memories = data.items || []
        if (event === 'token') { aiMsg.content += data.token; await scrollBottom() }
        if (event === 'done') {
          aiMsg.streaming = false
          // 对话结束后刷新画像（可能被更新了）
          setTimeout(loadProfile, 1500)
        }
      } catch {}
    }
  }

  loading.value = false
}
</script>

<style scoped>
.memory-chat { display: flex; height: 100vh; font-family: -apple-system, sans-serif; }

/* 左侧画像 */
.profile-panel { width: 240px; background: #fff; border-right: 1px solid #e5e7eb; display: flex; flex-direction: column; }
.panel-header { padding: 14px 16px; font-weight: 600; font-size: 14px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; }
.btn-refresh { background: none; border: none; cursor: pointer; font-size: 16px; color: #9ca3af; }
.empty-profile { padding: 20px 16px; font-size: 12px; color: #9ca3af; line-height: 1.6; }
.profile-items { padding: 12px; flex: 1; overflow-y: auto; }
.profile-row { margin-bottom: 10px; }
.p-label { display: block; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: #9ca3af; margin-bottom: 3px; }
.p-val { font-size: 13px; color: #374151; }
.p-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; }
.p-badge.senior { background: #fef3c7; color: #92400e; }
.p-badge.intermediate { background: #dbeafe; color: #1e40af; }
.p-badge.beginner { background: #dcfce7; color: #166534; }
.p-tags { display: flex; flex-wrap: wrap; gap: 4px; }
.p-tag { font-size: 10px; padding: 2px 7px; background: #f3f4f6; border-radius: 8px; color: #374151; }
.p-tag.green { background: #dcfce7; color: #166534; }
.profile-footer { padding: 12px 16px; border-top: 1px solid #e5e7eb; }
.btn-clear { width: 100%; padding: 7px 0; background: none; border: 1px solid #e5e7eb; border-radius: 6px; cursor: pointer; font-size: 12px; color: #9ca3af; }
.btn-clear:hover { border-color: #ef4444; color: #ef4444; }

/* 中：对话区 */
.chat-main { flex: 1; display: flex; flex-direction: column; background: #f8f9fa; }
.messages { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 16px; }
.empty-chat { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #9ca3af; gap: 8px; }
.empty-icon { font-size: 40px; }
.empty-sub { font-size: 12px; }

.message-wrap { display: flex; flex-direction: column; gap: 4px; }

/* 记忆提示 */
.memory-hint { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #6d28d9; background: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 6px; padding: 5px 10px; cursor: default; position: relative; }
.memory-icon { font-size: 13px; }
.memory-list { display: none; }
.memory-hint:hover .memory-list {
  display: block; position: absolute; top: 100%; left: 0; z-index: 10;
  background: #fff; border: 1px solid #e5e7eb; border-radius: 6px;
  padding: 8px; min-width: 200px; box-shadow: 0 4px 12px rgba(0,0,0,.1);
}
.memory-item { font-size: 11px; color: #374151; padding: 3px 0; border-bottom: 1px solid #f3f4f6; }

.message { display: flex; gap: 10px; align-items: flex-start; }
.message.user { flex-direction: row-reverse; }
.avatar { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; color: #fff; flex-shrink: 0; }
.message.user .avatar { background: #059669; }
.message.assistant .avatar { background: #4f46e5; }
.bubble { max-width: 78%; padding: 10px 14px; border-radius: 12px; font-size: 14px; line-height: 1.7; }
.message.user .bubble { background: #4f46e5; color: #fff; border-radius: 12px 4px 12px 12px; }
.message.assistant .bubble { background: #fff; color: #1f2937; border-radius: 4px 12px 12px 12px; border: 1px solid #e5e7eb; }
.cursor { display: inline-block; width: 2px; height: 1em; background: #374151; vertical-align: text-bottom; animation: blink .7s infinite; }
@keyframes blink { 0%,100%{opacity:1}50%{opacity:0} }

/* 输入区 */
.input-area { padding: 12px 16px; background: #fff; border-top: 1px solid #e5e7eb; }
.user-id-bar { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; font-size: 12px; color: #6b7280; }
.id-input { padding: 3px 8px; border: 1px solid #e5e7eb; border-radius: 4px; font-size: 12px; width: 80px; outline: none; }
.id-hint { color: #9ca3af; font-size: 11px; }
.input-row { display: flex; gap: 10px; }
textarea { flex: 1; padding: 10px 14px; border: 1px solid #e5e7eb; border-radius: 8px; resize: none; font-size: 14px; font-family: inherit; outline: none; }
textarea:focus { border-color: #4f46e5; }
.btn-send { padding: 0 20px; background: #4f46e5; color: #fff; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; }
.btn-send:disabled { opacity: .45; }
</style>
