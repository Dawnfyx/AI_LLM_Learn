<!-- 06-vue-workflow-app/WorkflowVisualizer.vue -->
<!-- 工作流可视化：用流程图展示每个节点的执行状态和结果 -->
<template>
  <div class="workflow-app">
    <!-- 左：配置区 -->
    <aside class="config-panel">
      <div class="panel-title">⚙️ 工作流配置</div>

      <div class="form-group">
        <label>文章主题</label>
        <input v-model="topic" placeholder="如：Vue3 响应式原理详解" :disabled="running" />
      </div>

      <div class="form-group">
        <label>目标受众</label>
        <select v-model="audience" :disabled="running">
          <option value="前端开发者">前端开发者</option>
          <option value="初学者">初学者</option>
          <option value="技术团队 Lead">技术 Lead</option>
        </select>
      </div>

      <button
        @click="runWorkflow"
        :disabled="running || !topic.trim()"
        class="btn-run"
      >
        {{ running ? '执行中...' : '▶ 运行工作流' }}
      </button>

      <!-- 执行结果摘要 -->
      <div v-if="summary" class="summary">
        <div class="summary-item">
          <span class="label">SEO 评分</span>
          <span class="value" :class="summary.seoScore >= 80 ? 'good' : 'warn'">
            {{ summary.seoScore }}/100
          </span>
        </div>
        <div class="summary-item">
          <span class="label">文章字数</span>
          <span class="value">{{ summary.wordCount }} 字</span>
        </div>
        <div class="summary-item" v-if="summary.keywords?.length">
          <span class="label">关键词</span>
          <div class="tags">
            <span v-for="kw in summary.keywords" :key="kw" class="tag">{{ kw }}</span>
          </div>
        </div>
      </div>
    </aside>

    <!-- 中：工作流可视化 -->
    <main class="flow-panel">
      <div class="panel-title">📊 执行流程</div>

      <div class="flow-chart">
        <div
          v-for="(node, idx) in flowNodes"
          :key="node.id"
          class="flow-step"
        >
          <!-- 节点卡片 -->
          <div class="node-card" :class="node.status">
            <div class="node-header">
              <span class="node-icon">{{ node.icon }}</span>
              <span class="node-label">{{ node.label }}</span>
              <span class="node-status-badge" :class="node.status">
                {{ statusText(node.status) }}
              </span>
            </div>

            <!-- 执行结果 -->
            <div v-if="node.result" class="node-result">
              {{ node.result }}
            </div>

            <!-- 执行中的 token 流 -->
            <div v-if="node.id === 'draft' && node.status === 'running' && draftStream" class="draft-stream">
              {{ draftStream }}<span class="cursor" />
            </div>

            <!-- 进度动画 -->
            <div v-if="node.status === 'running'" class="progress-bar">
              <div class="progress-fill" />
            </div>
          </div>

          <!-- 连接箭头（最后一个节点不显示） -->
          <div v-if="idx < flowNodes.length - 1" class="arrow">
            <div class="arrow-line" :class="{ active: node.status === 'done' }" />
            <div class="arrow-head" :class="{ active: node.status === 'done' }" />
          </div>
        </div>
      </div>
    </main>

    <!-- 右：输出预览 -->
    <aside class="output-panel">
      <div class="panel-title">📝 生成内容</div>

      <div v-if="!finalContent" class="output-empty">
        运行工作流后，最终文章将在这里展示
      </div>

      <div v-else class="output-content">
        {{ finalContent }}
      </div>
    </aside>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'

const API = 'http://localhost:3000'

const topic    = ref('Vue3 Composition API 实战指南')
const audience = ref('前端开发者')
const running  = ref(false)
const draftStream = ref('')
const finalContent = ref('')
const summary = ref(null)

// 工作流节点配置
const flowNodes = reactive([
  { id: 'keywords', label: '关键词提取', icon: '🔑', status: 'idle', result: null },
  { id: 'outline',  label: '大纲生成',   icon: '📋', status: 'idle', result: null },
  { id: 'draft',    label: '内容撰写',   icon: '✍️', status: 'idle', result: null },
  { id: 'seo',      label: 'SEO 检查',  icon: '🔍', status: 'idle', result: null },
  { id: 'polish',   label: '润色发布',   icon: '✨', status: 'idle', result: null },
])

function statusText(status) {
  const map = { idle: '等待', running: '执行中', done: '完成', error: '失败' }
  return map[status] || status
}

function resetNodes() {
  flowNodes.forEach(n => { n.status = 'idle'; n.result = null })
  draftStream.value = ''
  finalContent.value = ''
  summary.value = null
}

function updateNode(nodeId, updates) {
  const node = flowNodes.find(n => n.id === nodeId)
  if (node) Object.assign(node, updates)
}

async function runWorkflow() {
  if (!topic.value.trim() || running.value) return
  running.value = true
  resetNodes()

  try {
    const res = await fetch(`${API}/api/workflow/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: topic.value, audience: audience.value }),
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

          if (event === 'node_start') {
            updateNode(data.node, { status: 'running' })
          }

          if (event === 'token' && data.node === 'draft') {
            draftStream.value += data.token
          }

          if (event === 'node_done') {
            updateNode(data.node, { status: 'done', result: data.result })
            if (data.node === 'draft') draftStream.value = ''
            if (data.node === 'polish') finalContent.value = data.result
          }

          if (event === 'complete') {
            summary.value = {
              seoScore: data.seoScore,
              wordCount: data.wordCount,
              keywords: data.keywords,
            }
          }
        } catch {}
      }
    }
  } catch (e) {
    console.error('工作流执行失败：', e.message)
    flowNodes.forEach(n => { if (n.status === 'running') n.status = 'error' })
  } finally {
    running.value = false
  }
}
</script>

<style scoped>
.workflow-app { display: flex; height: 100vh; font-family: -apple-system, sans-serif; background: #f8f9fa; gap: 0; }

/* 通用 */
.panel-title { padding: 14px 16px; font-weight: 600; font-size: 14px; border-bottom: 1px solid #e5e7eb; }

/* 左：配置区 */
.config-panel { width: 240px; background: #fff; border-right: 1px solid #e5e7eb; display: flex; flex-direction: column; }
.form-group { padding: 12px 16px 0; }
.form-group label { display: block; font-size: 12px; color: #6b7280; margin-bottom: 5px; }
.form-group input, .form-group select { width: 100%; padding: 7px 10px; border: 1px solid #e5e7eb; border-radius: 6px; font-size: 13px; box-sizing: border-box; outline: none; }
.btn-run { margin: 16px; padding: 10px 0; background: #4f46e5; color: #fff; border: none; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 500; }
.btn-run:disabled { opacity: .45; cursor: not-allowed; }

.summary { margin: 0 16px; padding: 12px; background: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb; }
.summary-item { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
.summary-item .label { font-size: 11px; color: #9ca3af; }
.summary-item .value { font-size: 13px; font-weight: 500; }
.summary-item .value.good { color: #15803d; }
.summary-item .value.warn { color: #b45309; }
.tags { display: flex; flex-wrap: wrap; gap: 4px; }
.tag { font-size: 10px; padding: 1px 6px; background: #ede9fe; color: #6d28d9; border-radius: 8px; }

/* 中：流程图 */
.flow-panel { flex: 1; background: #fff; border-right: 1px solid #e5e7eb; overflow-y: auto; }
.flow-chart { padding: 20px; display: flex; flex-direction: column; align-items: center; gap: 0; }
.flow-step { display: flex; flex-direction: column; align-items: center; width: 100%; max-width: 400px; }

/* 节点卡片 */
.node-card { width: 100%; padding: 12px 14px; border: 1.5px solid #e5e7eb; border-radius: 10px; background: #fff; transition: all .25s; }
.node-card.running { border-color: #3b82f6; box-shadow: 0 0 0 3px #3b82f620; }
.node-card.done { border-color: #22c55e; background: #f0fdf4; }
.node-card.error { border-color: #ef4444; background: #fef2f2; }

.node-header { display: flex; align-items: center; gap: 8px; }
.node-icon { font-size: 16px; }
.node-label { font-size: 13px; font-weight: 600; color: #374151; flex: 1; }
.node-status-badge { font-size: 10px; padding: 2px 8px; border-radius: 10px; }
.node-card.idle    .node-status-badge { background: #f3f4f6; color: #9ca3af; }
.node-card.running .node-status-badge { background: #eff6ff; color: #1d4ed8; }
.node-card.done    .node-status-badge { background: #f0fdf4; color: #15803d; }
.node-card.error   .node-status-badge { background: #fef2f2; color: #b91c1c; }

.node-result { margin-top: 8px; font-size: 12px; color: #6b7280; padding: 6px 8px; background: rgba(0,0,0,.03); border-radius: 4px; }
.draft-stream { margin-top: 8px; font-size: 12px; color: #374151; max-height: 80px; overflow-y: auto; padding: 6px 8px; background: #f9fafb; border-radius: 4px; white-space: pre-wrap; }
.cursor { display: inline-block; width: 2px; height: 1em; background: #4f46e5; vertical-align: text-bottom; animation: blink .7s infinite; }
@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }

.progress-bar { height: 2px; background: #e5e7eb; border-radius: 1px; overflow: hidden; margin-top: 8px; }
.progress-fill { height: 100%; width: 40%; background: #3b82f6; animation: slide 1.2s ease-in-out infinite; }
@keyframes slide { 0%{transform:translateX(-200%)} 100%{transform:translateX(400%)} }

.arrow { display: flex; flex-direction: column; align-items: center; height: 28px; position: relative; }
.arrow-line { width: 2px; height: 20px; background: #e5e7eb; transition: background .3s; }
.arrow-line.active { background: #22c55e; }
.arrow-head { width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-top: 6px solid #e5e7eb; transition: border-top-color .3s; }
.arrow-head.active { border-top-color: #22c55e; }

/* 右：输出预览 */
.output-panel { width: 300px; background: #fff; display: flex; flex-direction: column; overflow: hidden; }
.output-empty { flex: 1; display: flex; align-items: center; justify-content: center; color: #9ca3af; font-size: 13px; text-align: center; padding: 20px; }
.output-content { flex: 1; overflow-y: auto; padding: 16px; font-size: 13px; line-height: 1.75; white-space: pre-wrap; color: #374151; }
</style>
