<!-- PromptBuilder.vue — 可视化提示词模板管理器 -->
<template>
  <div class="prompt-builder">
    <aside class="template-panel">
      <h3>提示词模板库</h3>
      <div
        v-for="tpl in templates"
        :key="tpl.id"
        class="tpl-item"
        :class="{ active: selected?.id === tpl.id }"
        @click="select(tpl)"
      >
        <span class="tpl-name">{{ tpl.name }}</span>
        <span class="tpl-badge">{{ tpl.category }}</span>
      </div>
    </aside>

    <main class="editor-panel" v-if="selected">
      <h3>填写参数</h3>
      <div v-for="v in selected.variables" :key="v.key" class="field">
        <label>{{ v.label }}</label>
        <textarea v-if="v.multiline" v-model="values[v.key]" :placeholder="v.placeholder" rows="4" />
        <input v-else v-model="values[v.key]" :placeholder="v.placeholder" />
      </div>

      <div class="preview-block">
        <div class="preview-label">预览 Prompt</div>
        <pre>{{ compiled }}</pre>
      </div>

      <button @click="send" :disabled="loading">{{ loading ? '生成中...' : '生成' }}</button>

      <div class="result" v-if="result">
        <div class="result-label">生成结果</div>
        <div class="result-body">{{ result }}</div>
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref, computed, reactive } from 'vue'

const templates = [
  {
    id: 'code-review',
    name: '代码审查',
    category: '开发效率',
    system: '你是资深前端工程师，专注代码质量。',
    user: `审查以下 {{lang}} 代码，重点关注 {{focus}}：

\`\`\`{{lang}}
{{code}}
\`\`\`

按顺序输出：① 整体评价 ② 发现的问题（列表）③ 改进建议（含代码示例）`,
    variables: [
      { key: 'lang', label: '语言/框架', placeholder: 'Vue3 / React / Node.js' },
      { key: 'focus', label: '审查重点', placeholder: '性能、可读性、安全性' },
      { key: 'code', label: '代码', placeholder: '粘贴代码...', multiline: true },
    ],
  },
  {
    id: 'component-design',
    name: '组件设计',
    category: '开发效率',
    system: '你是 Vue3 组件设计专家。',
    user: `设计一个 {{name}} 组件：
功能需求：{{requirements}}
技术约束：{{constraints}}

输出：① Props/Emits/Slots 定义 ② 核心实现思路 ③ 使用示例`,
    variables: [
      { key: 'name', label: '组件名称', placeholder: 'ImageCropper' },
      { key: 'requirements', label: '功能需求', placeholder: '描述组件功能...', multiline: true },
      { key: 'constraints', label: '技术约束', placeholder: '不依赖第三方库' },
    ],
  },
  {
    id: 'bug-analysis',
    name: 'Bug 分析',
    category: '调试',
    system: '你是前端调试专家，擅长定位复杂问题。',
    user: `分析以下 Bug：

现象：{{symptom}}
复现步骤：{{steps}}
相关代码：
\`\`\`
{{code}}
\`\`\`
报错信息：{{error}}

请分析：① 根本原因 ② 修复方案（含代码） ③ 如何避免类似问题`,
    variables: [
      { key: 'symptom', label: '问题现象', placeholder: '页面空白 / 数据不更新...', multiline: true },
      { key: 'steps', label: '复现步骤', placeholder: '1. 打开页面 2. 点击按钮 3. ...', multiline: true },
      { key: 'code', label: '相关代码', placeholder: '', multiline: true },
      { key: 'error', label: '报错信息', placeholder: 'TypeError: Cannot read...' },
    ],
  },
]

const selected = ref(null)
const values = reactive({})
const result = ref('')
const loading = ref(false)

function select(tpl) {
  selected.value = tpl
  tpl.variables.forEach(v => { values[v.key] = '' })
  result.value = ''
}

// 模板编译：{{变量}} → 实际值
const compiled = computed(() => {
  if (!selected.value) return ''
  return selected.value.user.replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] || `{{${k}}}`)
})

async function send() {
  if (!selected.value || loading.value) return
  loading.value = true
  result.value = ''
  try {
    const res = await fetch('/api/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system: selected.value.system, user: compiled.value }),
    })
    const data = await res.json()
    result.value = data.content
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.prompt-builder { display: grid; grid-template-columns: 240px 1fr; gap: 24px; height: 100vh; padding: 24px; }
.template-panel h3, .editor-panel h3 { margin: 0 0 16px; font-size: 15px; color: #374151; }
.tpl-item { padding: 10px 14px; border-radius: 6px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.tpl-item:hover { background: #f3f4f6; }
.tpl-item.active { background: #ede9fe; }
.tpl-badge { font-size: 11px; padding: 2px 8px; background: #e5e7eb; border-radius: 20px; color: #6b7280; }
.field { margin-bottom: 16px; }
.field label { display: block; font-size: 13px; color: #374151; margin-bottom: 6px; font-weight: 500; }
.field input, .field textarea { width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px; box-sizing: border-box; }
.preview-block { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 16px; margin: 20px 0; }
.preview-label { font-size: 12px; color: #9ca3af; margin-bottom: 8px; }
pre { margin: 0; font-size: 13px; white-space: pre-wrap; color: #374151; }
button { padding: 10px 24px; background: #4f46e5; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; }
button:disabled { opacity: .5; }
.result { margin-top: 24px; }
.result-label { font-size: 12px; color: #9ca3af; margin-bottom: 8px; }
.result-body { background: #fff; border: 1px solid #e5e7eb; border-radius: 6px; padding: 16px; white-space: pre-wrap; line-height: 1.7; font-size: 14px; }
</style>
