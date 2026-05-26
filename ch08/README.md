# 第八章配套代码：Workflow 工作流

```
ch08/
├── 01-basic-workflow/          线性工作流：文章写作 4 步流程
├── 02-conditional-workflow/    条件工作流：代码审查按类型分支
├── 03-parallel-workflow/       并行工作流：多维度同时分析
├── 04-human-in-loop/           Human-in-the-Loop：人工审核中断点
├── 05-workflow-with-state/     状态持久化：检查点、恢复、回滚
├── 06-vue-workflow-app/        Vue3 工作流可视化界面
└── 07-react-workflow-app/      React 版工作流可视化
```

```bash
cd 01-basic-workflow && npm install
echo "DEEPSEEK_API_KEY=你的key" > .env
node index.js
```
