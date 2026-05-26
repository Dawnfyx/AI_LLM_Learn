<!-- VueStream.vue -->
<!-- Vue3 组合式 API 实现流式输出，可直接集成到 Vite 项目 -->
<template>
  <div class="chat-demo">
    <textarea v-model="input" placeholder="输入你的问题..." rows="3" />
    <button @click="sendMessage" :disabled="loading">
      {{ loading ? '生成中...' : '发送' }}
    </button>
    <div class="output" v-if="output || loading">
      <span>{{ output }}</span>
      <span v-if="loading" class="cursor" />
    </div>
    <div class="stats" v-if="stats">
      耗时 {{ stats.duration }}ms · 约 {{ stats.tokens }} tokens
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const input = ref('解释一下 Vue3 的 Composition API')
const output = ref('')
const loading = ref(false)
const stats = ref(null)

async function sendMessage() {
  if (!input.value.trim() || loading.value) return

  loading.value = true
  output.value = ''
  stats.value = null
  const startTime = Date.now()

  const res = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: input.value }),
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
          if (data.token) output.value += data.token
        } catch {}
      }
      if (line === 'event: done') {
        loading.value = false
        stats.value = {
          duration: Date.now() - startTime,
          tokens: Math.round(output.value.length / 2), // 粗略估算
        }
      }
    }
  }

  loading.value = false
}
</script>

<style scoped>
.chat-demo { display: flex; flex-direction: column; gap: 12px; max-width: 640px; }
textarea { padding: 10px; border: 1px solid #ddd; border-radius: 6px; resize: vertical; font-size: 14px; }
button { align-self: flex-start; padding: 8px 20px; background: #4f46e5; color: #fff;
         border: none; border-radius: 6px; cursor: pointer; }
button:disabled { opacity: .5; }
.output { padding: 16px; background: #f8f8f8; border-radius: 6px; white-space: pre-wrap; line-height: 1.7; min-height: 80px; }
.cursor { display: inline-block; width: 2px; height: 1em; background: #333;
          animation: blink .7s infinite; vertical-align: text-bottom; }
@keyframes blink { 0%,100%{opacity:1}50%{opacity:0} }
.stats { font-size: 12px; color: #888; }
</style>
