# 第五章配套代码：MCP 协议

## 目录

```
ch05/
├── 01-mcp-server-basic/    最简 MCP Server（stdio）：工具 + 资源
├── 02-mcp-server-tools/    HTTP+SSE 传输的 MCP Server：工具 + 提示词模板
├── 03-mcp-client/          MCP Client：连接 Server、调用工具、集成 LangChain
├── 04-mcp-with-express/    Express AI 应用集成多个 MCP Server
├── 05-vue-mcp-demo/        Vue3 MCP 工具管理面板
└── 06-react-mcp-demo/      React 版 MCP 工具管理面板
```

## 运行顺序

```bash
# 第一步：启动 MCP Server（stdio 版）
cd 01-mcp-server-basic && npm install
# stdio 模式由 client 自动启动，无需手动运行

# 第二步：启动 HTTP+SSE 版 MCP Server（可选）
cd 02-mcp-server-tools && npm install
node server-http.js  # 监听 3001 端口

# 第三步：测试 MCP Client
cd 03-mcp-client && npm install
echo "DEEPSEEK_API_KEY=你的key" > .env
node client.js

# 第四步：启动完整 AI 应用
cd 04-mcp-with-express && npm install
echo "DEEPSEEK_API_KEY=你的key" > .env
node index.js  # 监听 3000 端口
```
