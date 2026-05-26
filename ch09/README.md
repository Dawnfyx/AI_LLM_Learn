# 第九章配套代码：长期记忆

```
ch09/
├── 01-session-memory/      会话记忆三种方案：全量/滑动窗口/摘要压缩
├── 02-user-profile/        用户画像：从对话提取，持久化，个性化回答
├── 03-long-term-memory/    长期记忆：向量存储，跨会话检索
├── 04-memory-compression/  上下文窗口管理：token 计数，分层记忆
├── 05-vue-memory-app/      Vue3 记忆系统完整应用
└── 06-react-memory-app/    React 版记忆应用
```

```bash
cd 01-session-memory && npm install
echo "DEEPSEEK_API_KEY=你的key" > .env
node index.js
```
