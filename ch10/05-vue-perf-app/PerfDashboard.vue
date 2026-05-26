<!-- 05-vue-perf-app/PerfDashboard.vue -->
<!-- 性能监控仪表盘：实时展示缓存命中率、Token 消耗、API 费用 -->
<template>
  <div class="perf-app">
    <!-- 指标卡片区 -->
    <div class="metrics-row">
      <MetricCard
        label="缓存命中率"
        :value="monitor.cache?.hitRate || '0%'"
        :sub="`命中 ${monitor.cache?.hits || 0} / 总计 ${(monitor.cache?.hits || 0) + (monitor.cache?.misses || 0)}`"
        color="purple"
        icon="⚡"
      />
      <MetricCard
        label="今日 API 调用"
        :value="monitor.cost?.calls || 0"
        :sub="`均 ${monitor.cost?.avgPerCall || '$0'}/次`"
        color="blue"
        icon="🔗"
      />
      <MetricCard
        label="今日费用"
        :value="monitor.cost?.costCNY || '¥0'"
        :sub="monitor.cost?.costUSD || '$0'"
        color="amber"
        icon="💰"
      />
      <MetricCard
        label="限流桶余量"
        :value="`${parseFloat(monitor.rateLimiter?.currentTokens || 0).toFixed(0)} / ${monitor.rateLimiter?.capacity || 20}`"
        :sub="`补充速率 ${monitor.rateLimiter?.refillRate || '5/s'}`"
        color="green"
        icon="🪣"
      />
    </div>

    <!-- 主内容：左边聊天，右边监控 -->
    <div class="main-content">
      <!-- 聊天区 -->
      <div class="chat-panel">
        <div class="panel-header">💬 对话测试</div>

        <div class="messages" ref="messagesEl">
          <div v-if="messages.length === 0" class="empty">
            发送消息，观察右侧指标变化
          </div>

          <div v-for="msg in messages" :key="msg.id" class="msg-wrap">
            <div class="msg" :class="msg.role">
              <div class="bubble">
                {{ msg.content }}
                <span v-if="msg.streaming" class="cursor" />
              </div>
              <!-- 费用标签 -->
              <div v-if="msg.cost && !msg.fromCache" class="cost-tag">
                ¥{{ msg.cost.cny?.toFixed(4) }}
              </div>
              <div v-if="msg.fromCache" class="cache-tag">⚡ 缓存</div>
            </div>
          </div>
        </div>

        <div class="input-row">
          <input
            v-model="input"
            @keyup.enter="send"
            placeholder="输入消息（相同消息会命中缓存）..."
            :disabled="loading"
          />
          <button @click="send" :disabled="loading || !input.trim()">
            {{ loading ? '...' : '发送' }}
          </button>
        </div>
      </div>

      <!-- 监控面板 -->
      <div class="monitor-panel">
        <div class="panel-header">
          📊 实时监控
          <button class="btn-refresh" @click="loadMonitor">↻</button>
        </div>

        <!-- 缓存统计 -->
        <div class="monitor-section">
          <div class="section-title">缓存状态</div>
          <div class="stat-row">
            <span>缓存条目</span><span>{{ monitor.cache?.size || 0 }}</span>
          </div>
          <div class="stat-row">
            <span>节省费用</span>
            <span class="highlight">{{ monitor.cache?.totalSavedUSD || '$0' }}</span>
          </div>
          <div class="hit-bar">
            <div
              class="hit-fill"
              :style="{ width: monitor.cache?.hitRate || '0%' }"
            />
          </div>
          <div class="bar-label">命中率 {{ monitor.cache?.hitRate || '0%' }}</div>
        </div>

        <!-- 最近 5 条调用记录 -->
        <div class="monitor-section">
          <div class="section-title">最近调用</div>
          <div
            v-for="(rec, i) in (monitor.cost?.recentRecords || [])"
            :key="i"
            class="record-row"
          >
            <span class="record-time">{{ rec.time?.slice(11, 19) }}</span>
            <span>{{ rec.inputT }}in/{{ rec.outputT }}out</span>
            <span class="record-cost">¥{{ rec.cny?.toFixed(4) }}</span>
          </div>
          <div v-if="!monitor.cost?.recentRecords?.length" class="no-data">暂无调用记录</div>
        </div>

        <!-- Token 总量 -->
        <div class="monitor-section">
          <div class="section-title">Token 消耗</div>
          <div class="stat-row">
            <span>总 Token</span>
            <span>{{ monitor.cost?.tokens?.toLocaleString() || 0 }}</span>
          </div>
          <div class="stat-row">
            <span>总费用(USD)</span>
            <span>{{ monitor.cost?.costUSD || '$0' }}</span>
          </div>
          <div class="stat-row">
            <span>总费用(CNY)</span>
            <span class="highlight">{{ monitor.cost?.costCNY || '¥0' }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick, onMounted, onUnmounted } from 'vue'

const API = 'http://localhost:3000'

const input    = ref('')
const messages = ref([])
const loading  = ref(false)
const monitor  = ref({})
const messagesEl = ref(null)
let msgId = 0
let pollTimer = null

onMounted(() => {
  loadMonitor()
  pollTimer = setInterval(loadMonitor, 5000)  // 每5秒刷新
})
onUnmounted(() => clearInterval(pollTimer))

async function loadMonitor() {
  try {
    const res = await fetch(`${API}/api/monitor`)
    monitor.value = await res.json()
  } catch {}
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

  const aiMsg = { id: ++msgId, role: 'assistant', content: '', streaming: true }
  messages.value.push(aiMsg)

  const res = await fetch(`${API}/api/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: msg }),
  })

  const reader  = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer    = ''

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
        if (event === 'cache_hit') aiMsg.fromCache = true
        if (event === 'token')     { aiMsg.content += data.token; await scrollBottom() }
        if (event === 'done') {
          aiMsg.streaming = false
          aiMsg.cost = data.cost
          aiMsg.fromCache = data.fromCache
          await loadMonitor()  // 刷新监控数据
        }
      } catch {}
    }
  }

  loading.value = false
}
</script>

<script>
// MetricCard 子组件
const MetricCard = {
  props: ['label', 'value', 'sub', 'color', 'icon'],
  template: `
    <div class="metric-card" :class="'color-' + color">
      <div class="metric-icon">{{ icon }}</div>
      <div class="metric-value">{{ value }}</div>
      <div class="metric-label">{{ label }}</div>
      <div class="metric-sub">{{ sub }}</div>
    </div>
  `,
}
export default { components: { MetricCard } }
</script>

<style scoped>
.perf-app { display: flex; flex-direction: column; height: 100vh; font-family: -apple-system, sans-serif; background: #f8f9fa; }

/* 指标卡片 */
.metrics-row { display: flex; gap: 12px; padding: 16px; }
.metric-card { flex: 1; padding: 14px 16px; border-radius: 10px; background: #fff; border: 1px solid #e5e7eb; }
.metric-card.color-purple { border-top: 3px solid #8b5cf6; }
.metric-card.color-blue   { border-top: 3px solid #3b82f6; }
.metric-card.color-amber  { border-top: 3px solid #f59e0b; }
.metric-card.color-green  { border-top: 3px solid #22c55e; }
.metric-icon { font-size: 20px; margin-bottom: 6px; }
.metric-value { font-size: 22px; font-weight: 700; color: #1f2937; }
.metric-label { font-size: 11px; color: #9ca3af; text-transform: uppercase; letter-spacing: .06em; margin-top: 2px; }
.metric-sub { font-size: 11px; color: #6b7280; margin-top: 3px; }

/* 主内容 */
.main-content { flex: 1; display: flex; gap: 0; overflow: hidden; }
.panel-header { padding: 12px 16px; font-weight: 600; font-size: 13px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; }
.btn-refresh { background: none; border: none; cursor: pointer; color: #9ca3af; font-size: 15px; }

/* 聊天区 */
.chat-panel { flex: 1; background: #fff; border-right: 1px solid #e5e7eb; display: flex; flex-direction: column; }
.messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
.empty { text-align: center; color: #9ca3af; font-size: 13px; margin-top: 40px; }
.msg-wrap { display: flex; flex-direction: column; }
.msg { display: flex; align-items: flex-end; gap: 6px; }
.msg.user { justify-content: flex-end; }
.bubble { max-width: 75%; padding: 9px 13px; border-radius: 10px; font-size: 13px; line-height: 1.65; }
.msg.user .bubble { background: #4f46e5; color: #fff; border-radius: 10px 3px 10px 10px; }
.msg.assistant .bubble { background: #f3f4f6; color: #374151; border-radius: 3px 10px 10px 10px; }
.cursor { display: inline-block; width: 2px; height: 1em; background: currentColor; vertical-align: text-bottom; animation: blink .7s infinite; }
@keyframes blink { 0%,100%{opacity:1}50%{opacity:0} }
.cost-tag { font-size: 10px; color: #9ca3af; background: #f3f4f6; padding: 1px 6px; border-radius: 8px; }
.cache-tag { font-size: 10px; color: #6d28d9; background: #ede9fe; padding: 1px 6px; border-radius: 8px; }
.input-row { padding: 12px; border-top: 1px solid #e5e7eb; display: flex; gap: 8px; }
input { flex: 1; padding: 8px 12px; border: 1px solid #e5e7eb; border-radius: 7px; font-size: 13px; outline: none; }
input:focus { border-color: #4f46e5; }
button { padding: 8px 16px; background: #4f46e5; color: #fff; border: none; border-radius: 7px; cursor: pointer; font-size: 13px; }
button:disabled { opacity: .4; }

/* 监控面板 */
.monitor-panel { width: 260px; background: #fff; display: flex; flex-direction: column; overflow-y: auto; }
.monitor-section { padding: 12px 16px; border-bottom: 1px solid #f3f4f6; }
.section-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: #9ca3af; margin-bottom: 8px; }
.stat-row { display: flex; justify-content: space-between; font-size: 12px; color: #374151; margin-bottom: 5px; }
.highlight { color: #4f46e5; font-weight: 600; }
.hit-bar { height: 6px; background: #e5e7eb; border-radius: 3px; overflow: hidden; margin: 6px 0 2px; }
.hit-fill { height: 100%; background: #4f46e5; border-radius: 3px; transition: width .5s ease; }
.bar-label { font-size: 10px; color: #9ca3af; }
.record-row { display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #6b7280; padding: 3px 0; border-bottom: 1px solid #f9fafb; }
.record-time { color: #9ca3af; font-family: monospace; }
.record-cost { color: #f59e0b; font-weight: 500; }
.no-data { font-size: 12px; color: #9ca3af; text-align: center; padding: 8px 0; }
</style>
