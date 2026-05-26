# PromptBuilder.vue

Vue3 可视化提示词模板管理器，直接复制到 Vite 项目中使用。

依赖：无额外依赖，使用 Vue3 内置 API（ref / computed / reactive）

需要在项目中配置 /api/prompt 接口：
POST /api/prompt
Body: { system: string, user: string }
Response: { content: string }
