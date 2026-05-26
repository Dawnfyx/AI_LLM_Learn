# 第十二章配套代码：全书总结与项目架构

```
ch12/
├── 01-project-architecture/   完整项目结构设计和配置管理
├── 02-ci-cd/                  GitHub Actions CI/CD + 测试框架
├── 03-model-switch/           模型抽象层、工厂模式、熔断器
├── 04-ab-testing/             Prompt/模型 A/B 测试框架
└── 05-full-project/           生产级完整 Express 应用（集成全书能力）
```

## 快速启动

```bash
cd 05-full-project
npm install
echo "DEEPSEEK_API_KEY=你的key" > .env
node src/index.js
```
