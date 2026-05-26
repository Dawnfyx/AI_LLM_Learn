# 第十章配套代码：性能优化与成本控制

```
ch10/
├── 01-cache-strategy/      精确缓存 + 语义缓存 + 分级缓存
├── 02-token-optimization/  System Prompt 压缩、动态 Prompt、批量处理
├── 03-rate-limit-queue/    令牌桶限流、优先级队列、并发控制
├── 04-cost-monitor/        成本追踪回调、全局监控、预算告警
├── 05-vue-perf-app/        Vue3 性能监控仪表盘
└── 06-react-perf-app/      React 版监控仪表盘
```

```bash
cd 01-cache-strategy && npm install
echo "DEEPSEEK_API_KEY=你的key" > .env
node index.js
```
