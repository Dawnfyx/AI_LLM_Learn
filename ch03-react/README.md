# 第三章 React 技术栈代码示例

> 对应第三章 Vue3 版本代码，全部改为 React 实现。

## 目录结构

```
ch03-react/
├── 01-useChat-hook/
│   ├── useChat.js          核心 Hook：流式对话、取消、会话管理
│   └── ChatDemo.jsx        最简用法演示组件
│
├── 02-stream-component/
│   └── StreamMessage.jsx   流式消息组件（Markdown 渲染 + 代码块复制）
│
├── 03-session-manager/
│   ├── useSessionManager.js  多会话管理 Hook（持久化到 localStorage）
│   └── SessionSidebar.jsx    会话列表侧边栏组件
│
├── 04-langgraph-visualizer/
│   └── GraphVisualizer.jsx   LangGraph 工作流可视化组件（带执行动画）
│
└── 05-full-chat-app/         完整项目（Vite + React）
    ├── src/
    │   ├── App.jsx
    │   ├── main.jsx
    │   ├── hooks/
    │   │   └── useSessionManager.js
    │   └── components/
    │       ├── SessionSidebar.jsx
    │       ├── MessageList.jsx
    │       ├── StreamMessage.jsx
    │       ├── InputArea.jsx
    │       └── GraphVisualizer.jsx
    ├── index.html
    ├── package.json
    ├── vite.config.js
    └── .env.example
```

## 快速启动完整项目

```bash
# 1. 先启动后端（第三章 Vue 版本的 server.js）
cd ../ch03/07-vue-chat-app
npm install
echo "DEEPSEEK_API_KEY=你的key" > .env
npm run dev

# 2. 启动 React 前端
cd ../../ch03-react/05-full-chat-app
npm install
cp .env.example .env
npm run dev
# 访问 http://localhost:5173
```

## 各组件独立使用

### useChat Hook

```jsx
import { useChat } from './01-useChat-hook/useChat'

function MyChat() {
  const { messages, loading, streaming, streamContent, send, cancel } = useChat()

  return (
    <div>
      {messages.map(m => <div key={m.id}>{m.content}</div>)}
      {streaming && <div>{streamContent}<span className="cursor" /></div>}
      <button onClick={() => send('你好')}>发送</button>
      {streaming && <button onClick={cancel}>停止</button>}
    </div>
  )
}
```

### StreamMessage 组件

```jsx
import { StreamMessage } from './02-stream-component/StreamMessage'

// 渲染包含代码块的 Markdown 内容，代码块带复制按钮
<StreamMessage content={markdownText} isStreaming={false} />
```

### useSessionManager Hook

```jsx
import { useSessionManager } from './03-session-manager/useSessionManager'

const { sessions, currentId, createSession, deleteSession, switchSession } = useSessionManager()
```
