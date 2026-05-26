<!-- 05-vue-rag-app/RagApp.vue -->
<!-- 完整 RAG 应用：文档上传管理 + 问答界面 + 引用来源展示 -->
<template>
  <div class="rag-app">
    <!-- 左侧：知识库管理 -->
    <aside class="kb-panel">
      <div class="panel-header">
        📚 知识库
        <span class="badge">{{ documents.length }} 篇</span>
      </div>

      <!-- 上传文档 -->
      <div class="upload-area" @drop.prevent="onDrop" @dragover.prevent>
        <div class="upload-hint">
          <span>拖拽文档到此处</span>
          <span class="divider">或</span>
          <label class="upload-btn">
            选择文件
            <input type="file" accept=".txt,.md" @change="onFileChange" hidden />
          </label>
        </div>
      </div>

      <!-- 快速添加文本 -->
      <div class="text-input-area">
        <input v-model="docTitle" placeholder="文档标题" class="doc-input" />
        <select v-model="docCategory" class="doc-input">
          <option value="general">通用</option>
          <option value="technical">技术</option>
          <option value="business">业务</option>
        </select>
        <textarea
          v-model="docContent"
          placeholder="直接粘贴文档内容..."
          rows="4"
          class="doc-input"
        />
        <button @click="uploadText" :disabled="!docContent.trim() || uploading" class="btn-primary">
          {{ uploading ? '上传中...' : '添加到知识库' }}
        </button>
      </div>

      <!-- 文档列表 -->
      <div class="doc-list">
        <div v-if="documents.length === 0" class="empty-hint">
          暂无文档，请先上传
        </div>
        <div v-for="doc in documents" :key="doc.id" class="doc-item">
          <div class="doc-icon">📄</div>
          <div class="doc-info">
            <div class="doc-title">{{ doc.title }}</div>
            <div class="doc-meta">
              {{ doc.category }} · {{ doc.chunks }} 个片段
            </div>
          </div>
          <button class="btn-delete" @click="deleteDoc(doc.id)">×</button>
        </div>
      </div>
    </aside>

    <!-- 右侧：问答界面 -->
    <main class="chat-panel">
      <div class="messages" ref="messagesEl">
        <div v-if="messages.length === 0" class="empty-hint center">
          <div class="empty-icon">🔍</div>
          <div>上传文档后，向我提问吧</div>
          <div class="empty-sub">我会从知识库中找到相关内容来回答</div>
        </div>

        <div v-for="msg in messages" :key="msg.id" class="message" :class="msg.role">
          <!-- 用户消息 -->
          <div v-if="msg.role === 'user'" class="bubble user-bubble">
            {{ msg.content }}
          </div>

          <!-- AI 回答 -->
          <div v-else class="answer-wrapper">
            <!-- 引用来源 -->
            <div v-if="msg.sources?.length" class="sources">
              <div class="sources-label">📎 参考文档</div>
              <div class="source-tags">
                <span
                  v-for="s in msg.sources"
                  :key="s.title"
                  class="source-tag"
                  :title="`相似度 ${s.score}\n${s.preview}`"
                >
                  {{ s.title }}
                  <span class="source-score">{{ s.score }}</span>
                </span>
              </div>
            </div>

            <!-- 回答内容 -->
            <div class="bubble ai-bubble">
              {{ msg.content }}
              <span v-if="msg.streaming" class="cursor" />
            </div>
          </div>
        </div>

        <!-- 检索状态提示 -->
        <div v-if="statusMsg" class="status-msg">
          <span class="spinner" /> {{ statusMsg }}
        </div>
      </div>

      <!-- 输入区 -->
      <div class="input-area">
        <select v-model="filterCategory" class="category-filter">
          <option value="">搜索全部文档</option>
          <option value="technical">仅搜索技术文档</option>
          <option value="business">仅搜索业务文档</option>
        </select>
        <div class="input-row">
          <textarea
            v-model="question"
            @keydown.ctrl.enter="askQuestion"
            placeholder="输入问题... (Ctrl+Enter 提问)"
            rows="2"
          />
          <button
            @click="askQuestion"
            :disabled="loading || !question.trim()"
            class="btn-send"
          >
            {{ loading ? '...' : '提问' }}
          </button>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue'

const API = 'http://localhost:3000'

const documents = ref([])
const messages = ref([])
const question = ref('')
const loading = ref(false)
const statusMsg = ref('')
const filterCategory = ref('')
const docTitle = ref('')
const docCategory = ref('general')
const docContent = ref('')
const uploading = ref(false)
const messagesEl = ref(null)
let msgId = 0

onMounted(loadDocuments)

async function loadDocuments() {
  const res = await fetch(`${API}/api/documents`)
  const { documents: list } = await res.json()
  documents.value = list
}

async function uploadText() {
  if (!docContent.value.trim()) return
  uploading.value = true
  try {
    const res = await fetch(`${API}/api/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: docTitle.value || '未命名文档',
        category: docCategory.value,
        content: docContent.value,
      }),
    })
    const data = await res.json()
    if (data.success) {
      docContent.value = ''
      docTitle.value = ''
      await loadDocuments()
    }
  } finally {
    uploading.value = false
  }
}

async function onFileChange(e) {
  const file = e.target.files[0]
  if (!file) return
  const text = await file.text()
  docTitle.value = file.name.replace(/\.[^.]+$/, '')
  docContent.value = text
}

function onDrop(e) {
  const file = e.dataTransfer.files[0]
  if (file) {
    const reader = new FileReader()
    reader.onload = ev => {
      docTitle.value = file.name.replace(/\.[^.]+$/, '')
      docContent.value = ev.target.result
    }
    reader.readAsText(file)
  }
}

async function deleteDoc(docId) {
  await fetch(`${API}/api/documents/${docId}`, { method: 'DELETE' })
  await loadDocuments()
}

async function askQuestion() {
  if (!question.value.trim() || loading.value) return

  const q = question.value.trim()
  question.value = ''
  loading.value = true

  messages.value.push({ id: ++msgId, role: 'user', content: q })

  const aiMsg = { id: ++msgId, role: 'assistant', content: '', sources: [], streaming: true }
  messages.value.push(aiMsg)
  await scrollBottom()

  const res = await fetch(`${API}/api/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: q, category: filterCategory.value || undefined }),
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
        if (event === 'status') statusMsg.value = data.message
        if (event === 'sources') {
          aiMsg.sources = data.sources
          statusMsg.value = ''
        }
        if (event === 'token') {
          aiMsg.content += data.token
          await scrollBottom()
        }
        if (event === 'done') {
          aiMsg.streaming = false
          statusMsg.value = ''
        }
      } catch {}
    }
  }

  loading.value = false
  aiMsg.streaming = false
  await scrollBottom()
}

async function scrollBottom() {
  await nextTick()
  if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight
}
</script>

<style scoped>
.rag-app { display: flex; height: 100vh; font-family: -apple-system, sans-serif; background: #f8f9fa; }

.kb-panel { width: 300px; background: #fff; border-right: 1px solid #e5e7eb; display: flex; flex-direction: column; overflow: hidden; }
.panel-header { padding: 14px 16px; font-weight: 600; font-size: 14px; border-bottom: 1px solid #e5e7eb; display: flex; align-items: center; gap: 8px; }
.badge { font-size: 11px; background: #ede9fe; color: #6d28d9; padding: 2px 8px; border-radius: 10px; font-weight: 400; }

.upload-area { margin: 12px; border: 2px dashed #d1d5db; border-radius: 8px; padding: 16px; text-align: center; cursor: pointer; }
.upload-area:hover { border-color: #4f46e5; background: #f5f3ff; }
.upload-hint { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #9ca3af; }
.divider { font-size: 11px; }
.upload-btn { font-size: 12px; color: #4f46e5; cursor: pointer; text-decoration: underline; }

.text-input-area { padding: 0 12px 12px; display: flex; flex-direction: column; gap: 6px; }
.doc-input { padding: 7px 10px; border: 1px solid #e5e7eb; border-radius: 6px; font-size: 12px; font-family: inherit; width: 100%; box-sizing: border-box; outline: none; }
.doc-input:focus { border-color: #4f46e5; }
.btn-primary { padding: 8px 0; background: #4f46e5; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; width: 100%; }
.btn-primary:disabled { opacity: .45; }

.doc-list { flex: 1; overflow-y: auto; border-top: 1px solid #f3f4f6; padding: 8px 0; }
.empty-hint { padding: 16px; text-align: center; color: #9ca3af; font-size: 12px; }
.doc-item { padding: 8px 14px; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid #f9fafb; }
.doc-icon { font-size: 16px; }
.doc-info { flex: 1; min-width: 0; }
.doc-title { font-size: 12px; font-weight: 500; color: #374151; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.doc-meta { font-size: 10px; color: #9ca3af; margin-top: 2px; }
.btn-delete { background: none; border: none; color: #d1d5db; cursor: pointer; font-size: 16px; }
.btn-delete:hover { color: #ef4444; }

.chat-panel { flex: 1; display: flex; flex-direction: column; }
.messages { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 16px; }
.empty-hint.center { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 8px; }
.empty-icon { font-size: 40px; }
.empty-sub { font-size: 12px; }

.message { display: flex; }
.message.user { justify-content: flex-end; }
.bubble { padding: 10px 14px; border-radius: 12px; font-size: 14px; line-height: 1.7; max-width: 75%; }
.user-bubble { background: #4f46e5; color: #fff; border-radius: 12px 4px 12px 12px; }
.answer-wrapper { display: flex; flex-direction: column; gap: 8px; max-width: 80%; }
.ai-bubble { background: #f3f4f6; color: #1f2937; border-radius: 4px 12px 12px 12px; white-space: pre-wrap; }

.sources { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 8px 12px; }
.sources-label { font-size: 11px; color: #3b82f6; font-weight: 600; margin-bottom: 6px; }
.source-tags { display: flex; gap: 6px; flex-wrap: wrap; }
.source-tag { font-size: 11px; background: #fff; border: 1px solid #bfdbfe; padding: 2px 8px; border-radius: 10px; color: #1d4ed8; cursor: help; display: flex; align-items: center; gap: 4px; }
.source-score { color: #9ca3af; font-size: 10px; }

.cursor { display: inline-block; width: 2px; height: 1em; background: #374151; vertical-align: text-bottom; animation: blink .7s infinite; }
@keyframes blink { 0%,100%{opacity:1}50%{opacity:0} }

.status-msg { display: flex; align-items: center; gap: 8px; color: #6b7280; font-size: 13px; }
.spinner { width: 14px; height: 14px; border: 2px solid #e5e7eb; border-top-color: #4f46e5; border-radius: 50%; animation: spin .7s linear infinite; display: inline-block; }
@keyframes spin { to { transform: rotate(360deg); } }

.input-area { border-top: 1px solid #e5e7eb; padding: 12px 16px; background: #fff; }
.category-filter { font-size: 12px; padding: 4px 8px; border: 1px solid #e5e7eb; border-radius: 5px; margin-bottom: 8px; width: 100%; outline: none; }
.input-row { display: flex; gap: 10px; }
textarea { flex: 1; padding: 10px 14px; border: 1px solid #e5e7eb; border-radius: 8px; resize: none; font-size: 14px; font-family: inherit; outline: none; }
textarea:focus { border-color: #4f46e5; }
.btn-send { padding: 0 20px; background: #4f46e5; color: #fff; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; white-space: nowrap; }
.btn-send:disabled { opacity: .45; }
</style>
