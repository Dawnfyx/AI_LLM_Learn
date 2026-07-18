<template>
  <div>
    <textarea v-model="input" placeholder="输入你的问题..." rows="3" />
    <button @click="send" :disabled="loading">{{ loading ? '生成中...' : '发送' }}</button>
    <div class="output">
      {{ output }}<span v-if="loading" class="cursor" />
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const input = ref('')
const output = ref('')
const loading = ref(false)

async function send() {
  if (!input.value.trim() || loading.value) return
  loading.value = true
  output.value = ''

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
    buffer = lines.pop() // 保留未完整的行，等下一个 chunk 来拼

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6))
          if (data.token) output.value += data.token
        } catch {}
      }
      if (line === 'event: done') loading.value = false
    }
  }

  loading.value = false
}
</script>

<style scoped>
.cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  background: currentColor;
  vertical-align: text-bottom;
  animation: blink .7s infinite;
}
@keyframes blink { 0%, 100% { opacity: 1 } 50% { opacity: 0 } }
</style>