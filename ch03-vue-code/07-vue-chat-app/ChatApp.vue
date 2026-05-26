<!-- 07-vue-chat-app/ChatApp.vue -->
<!-- 完整的 Vue3 聊天界面：多轮对话、流式输出、会话管理 -->
<template>
  <div class="chat-layout">
    <!-- 侧边栏：会话列表 -->
    <aside class="sidebar">
      <div class="sidebar-header">
        <span>对话列表</span>
        <button class="btn-new" @click="newSession">＋ 新对话</button>
      </div>
      <div
        v-for="s in sessionList"
        :key="s.id"
        class="session-item"
        :class="{ active: s.id === currentSessionId }"
        @click="switchSession(s.id)"
      >
        <span class="session-title">{{ s.title }}</span>
        <button class="btn-del" @click.stop="deleteSession(s.id)">×</button>
      </div>
    </aside>

    <!-- 主聊天区 -->
    <main class="chat-main">
      <!-- 消息列表 -->
      <div class="messages" ref="messagesEl">
        <div v-if="messages.length === 0" class="empty-hint">
          开始一段新对话吧
        </div>
        <div
          v-for="(msg, i) in messages"
          :key="i"
          class="message"
          :class="msg.role"
        >
          <div class="avatar">{{ msg.role === 'user' ? '我' : 'AI' }}</div>
          <div class="bubble">
            <div class="content" v-html="formatContent(msg.content)" />
            <div class="meta">{{ msg.time }}</div>
          </div>
        </div>

        <!-- 流式输出的临时消息 -->
        <div v-if="streaming" class="message assistant">
          <div class="avatar">AI</div>
          <div class="bubble">
            <div class="content">{{ streamingContent }}<span class="cursor" /></div>
          </div>
        </div>
      </div>

      <!-- 输入区 -->
      <div class="input-area">
        <div class="input-toolbar">
          <select v-model="systemPrompt" class="prompt-select">
            <option value="你是前端开发助手，回答简洁专业。">前端助手</option>
            <option value="你是代码审查专家，重点关注代码质量和潜在问题。">代码审查</option>
            <option value="你是技术方案架构师，擅长分析技术选型和架构设计。">架构师</option>
          </select>
          <span class="char-count">{{ input.length }} 字</span>
        </div>
        <div class="input-row">
          <textarea
            v-model="input"
            ref="inputEl"
            placeholder="输入消息... (Ctrl+Enter 发送)"
            rows="3"
            @keydown.ctrl.enter="sendMessage"
          />
          <button
            class="btn-send"
            @click="sendMessage"
            :disabled="loading || !input.trim()"
          >
            {{ loading ? '...' : '发送' }}
          </button>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref, reactive, computed, nextTick, onMounted } from 'vue'

const API = 'http://localhost:3000'

// 状态
const sessions = reactive({})       // { sessionId: { title, messages } }
const currentSessionId = ref(null)
const input = ref('')
const loading = ref(false)
const streaming = ref(false)
const streamingContent = ref('')
const systemPrompt = ref('你是前端开发助手，回答简洁专业。')
const messagesEl = ref(null)
const inputEl = ref(null)

// 计算属性
const sessionList = computed(() =>
  Object.values(sessions).map(s => ({ id: s.id, title: s.title }))
)

const messages = computed(() =>
  currentSessionId.value ? sessions[currentSessionId.value]?.messages ?? [] : []
)

// 创建新会话
async function newSession() {
  const res = await fetch(`${API}/api/sessions`, { method: 'POST' })
  const { sessionId } = await res.json()

  sessions[sessionId] = {
    id: sessionId,
    title: '新对话',
    messages: [],
  }
  currentSessionId.value = sessionId
}

// 切换会话
async function switchSession(sessionId) {
  currentSessionId.value = sessionId

  // 从服务端加载历史
  const res = await fetch(`${API}/api/sessions/${sessionId}/history`)
  const data = await res.json()

  sessions[sessionId].messages = data.messages.map(m => ({
    ...m,
    time: formatTime(new Date()),
  }))

  await scrollToBottom()
}

// 删除会话
async function deleteSession(sessionId) {
  await fetch(`${API}/api/sessions/${sessionId}`, { method: 'DELETE' })
  delete sessions[sessionId]
  if (currentSessionId.value === sessionId) {
    currentSessionId.value = null
  }
}

// 发送消息（流式）
async function sendMessage() {
  if (!input.value.trim() || loading.value) return
  if (!currentSessionId.value) await newSession()

  const userMessage = input.value.trim()
  input.value = ''
  loading.value = true

  // 添加用户消息
  sessions[currentSessionId.value].messages.push({
    role: 'user',
    content: userMessage,
    time: formatTime(new Date()),
  })

  // 更新会话标题
  if (sessions[currentSessionId.value].messages.length === 1) {
    sessions[currentSessionId.value].title = userMessage.slice(0, 20)
  }

  await scrollToBottom()

  // 流式请求
  streaming.value = true
  streamingContent.value = ''

  try {
    const res = await fetch(`${API}/api/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: currentSessionId.value,
        message: userMessage,
        systemPrompt: systemPrompt.value,
      }),
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
            if (data.token) {
              streamingContent.value += data.token
              await scrollToBottom()
            }
          } catch {}
        }
        if (line === 'event: done') {
          // 流式结束，把临时内容转为正式消息
          sessions[currentSessionId.value].messages.push({
            role: 'assistant',
            content: streamingContent.value,
            time: formatTime(new Date()),
          })
          streaming.value = false
          streamingContent.value = ''
        }
      }
    }
  } catch (err) {
    sessions[currentSessionId.value].messages.push({
      role: 'assistant',
      content: `错误：${err.message}`,
      time: formatTime(new Date()),
    })
  } finally {
    loading.value = false
    streaming.value = false
    await scrollToBottom()
    inputEl.value?.focus()
  }
}

// 工具函数
function formatTime(date) {
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function formatContent(content) {
  // 简单处理代码块
  return content
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>')
}

async function scrollToBottom() {
  await nextTick()
  if (messagesEl.value) {
    messagesEl.value.scrollTop = messagesEl.value.scrollHeight
  }
}

onMounted(() => newSession())
</script>

<style scoped>
.chat-layout { display: flex; height: 100vh; background: #f5f5f5; }

.sidebar {
  width: 240px; background: #fff; border-right: 1px solid #e5e7eb;
  display: flex; flex-direction: column;
}
.sidebar-header {
  padding: 16px; display: flex; justify-content: space-between; align-items: center;
  font-weight: 500; border-bottom: 1px solid #e5e7eb;
}
.btn-new { padding: 4px 10px; background: #4f46e5; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; }
.session-item {
  padding: 12px 16px; cursor: pointer; display: flex; justify-content: space-between;
  align-items: center; border-bottom: 1px solid #f3f4f6;
}
.session-item:hover, .session-item.active { background: #f3f4f6; }
.session-title { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.btn-del { background: none; border: none; cursor: pointer; color: #9ca3af; font-size: 16px; }

.chat-main { flex: 1; display: flex; flex-direction: column; }

.messages { flex: 1; overflow-y: auto; padding: 24px; display: flex; flex-direction: column; gap: 16px; }
.empty-hint { text-align: center; color: #9ca3af; margin-top: 40px; }

.message { display: flex; gap: 12px; }
.message.user { flex-direction: row-reverse; }

.avatar {
  width: 36px; height: 36px; border-radius: 50%; background: #4f46e5;
  color: #fff; display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 500; flex-shrink: 0;
}
.message.user .avatar { background: #059669; }

.bubble { max-width: 70%; }
.message.user .bubble { align-items: flex-end; display: flex; flex-direction: column; }

.content {
  padding: 12px 16px; border-radius: 12px; background: #fff;
  line-height: 1.7; font-size: 14px; word-break: break-word;
}
.message.user .content { background: #4f46e5; color: #fff; }

.meta { font-size: 11px; color: #9ca3af; margin-top: 4px; padding: 0 4px; }

.cursor {
  display: inline-block; width: 2px; height: 1em;
  background: #374151; animation: blink .7s infinite; vertical-align: text-bottom;
}
@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }

.input-area { border-top: 1px solid #e5e7eb; background: #fff; padding: 16px; }
.input-toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.prompt-select { font-size: 12px; border: 1px solid #d1d5db; border-radius: 4px; padding: 4px 8px; }
.char-count { font-size: 12px; color: #9ca3af; }

.input-row { display: flex; gap: 12px; }
textarea {
  flex: 1; padding: 10px 14px; border: 1px solid #d1d5db; border-radius: 8px;
  resize: none; font-size: 14px; line-height: 1.6; font-family: inherit;
}
textarea:focus { outline: none; border-color: #4f46e5; }

.btn-send {
  padding: 0 20px; background: #4f46e5; color: #fff; border: none;
  border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 500;
}
.btn-send:disabled { opacity: .5; cursor: not-allowed; }

pre { background: #1e1e1e; color: #d4d4d4; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 13px; }
code { background: #f3f4f6; padding: 2px 6px; border-radius: 3px; font-size: 13px; }
pre code { background: none; padding: 0; }
</style>
