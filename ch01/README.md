# 第一章配套代码：大模型应用开发概述

## 目录结构

```
ch01/
├── 01-first-api-call/    # 第一个 API 调用
│   ├── nodejs-fetch.js   # 原生 fetch 调用（无依赖）
│   └── langchain-basic.js # LangChain.js 封装调用
├── 02-streaming/         # 流式输出
│   ├── server.js         # Express + SSE 服务端
│   ├── index.html        # 原生 JS 前端
│   └── VueStream.vue     # Vue3 组件版
└── 03-token-counter/     # Token 计算与成本估算
    ├── counter.js
    └── cost-estimator.js
```

## 快速运行

```bash
# 01 原生调用
cd 01-first-api-call && npm install
echo "DEEPSEEK_API_KEY=你的key" > .env
npm run fetch

# 02 流式输出
cd 02-streaming && npm install
npm start
# 访问 http://localhost:3000
```
