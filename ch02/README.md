# 第二章配套代码：提示词工程

```
ch02/
├── 01-basic-prompts/       含糊提示 vs 精确提示对比
├── 02-few-shot/            Few-shot 示例引导
├── 03-chain-of-thought/    思维链 (CoT) 提示
├── 04-output-format/       结构化 JSON 输出（Prompt约束 vs Schema约束）
└── 05-prompt-template-vue/ Vue3 可视化提示词模板管理器
```

每个子目录均可独立运行：
```bash
cd 01-basic-prompts
npm install
echo "DEEPSEEK_API_KEY=your_key" > .env
node index.js
```
