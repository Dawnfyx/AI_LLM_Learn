# 第三章配套代码：LangChain.js + LangGraph

## 目录结构

```
ch03/
├── 01-langchain-basics/      LangChain.js 核心：调用、多轮、批量、流式
├── 02-prompt-template/       ChatPromptTemplate、变量插值、partial
├── 03-lcel-chain/            LCEL 链式调用、顺序链、并行链
├── 04-memory-chain/          会话记忆：手动管理 vs RunnableWithMessageHistory
├── 05-langgraph-basics/      LangGraph 基础：StateGraph、节点、边
├── 06-langgraph-conditional/ 条件路由：智能分流 + 自我检查循环
└── 07-vue-chat-app/          完整项目：Vue3 + LangGraph 聊天应用
```

## 快速运行

```bash
# 各子目录独立运行
cd 01-langchain-basics
npm install
echo "DEEPSEEK_API_KEY=你的key" > .env
node index.js

# 07 聊天应用
cd 07-vue-chat-app
npm install
echo "DEEPSEEK_API_KEY=你的key" > .env
npm run dev
# 后端: http://localhost:3000
# ChatApp.vue 集成到你的 Vite 项目中使用
```
