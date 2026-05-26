# 第四章配套代码：Function Call（工具调用）

## 目录

```
ch04/
├── 01-basic-function-call/   基础：定义工具 → 绑定 → 执行 → 返回
├── 02-multi-tools/           多工具 + ToolNode 自动执行
├── 03-parallel-tools/        并行工具调用，验证性能提升
├── 04-tool-with-state/       有副作用的工具：增删改查
├── 05-vue-tool-dashboard/    Vue3 可视化：实时展示工具调用过程
└── 06-react-tool-dashboard/  React 版工具调用可视化面板
```

## 运行

```bash
# Node.js 示例（01~04）
cd 01-basic-function-call
npm install
echo "DEEPSEEK_API_KEY=你的key" > .env
node index.js

# 可视化 Dashboard（05）
cd 05-vue-tool-dashboard
npm install && echo "DEEPSEEK_API_KEY=你的key" > .env
node server.js   # 后端
# 把 ToolDashboard.vue 集成到 Vite 项目中使用

# React 版（06）
# 把 ToolDashboard.jsx 集成到 Vite React 项目中使用
```
