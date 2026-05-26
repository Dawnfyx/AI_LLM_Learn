# 第十一章配套代码：生产实战

```
ch11/
├── 01-docker-deploy/       Dockerfile + docker-compose + nginx 配置
├── 02-error-handling/      错误分类、重试、降级策略
├── 03-logging-tracing/     结构化日志 + 链路追踪
├── 04-health-monitor/      健康检查端点 + Prometheus 指标
├── 05-security/            输入校验、Prompt 注入防护、输出过滤
└── 06-vue-production-app/  生产级完整服务端（集成所有能力）
```

## 快速启动生产环境

```bash
# 1. 配置环境变量
cp .env.example .env
vim .env   # 填入真实的 key

# 2. 构建并启动所有服务
cd 01-docker-deploy
docker-compose up -d

# 3. 检查健康状态
curl http://localhost:3000/health
```
