# 第六章配套代码：RAG 检索增强生成

## 目录

```
ch06/
├── 01-embedding-basics/   Embedding 基础：向量生成、相似度计算
├── 02-vector-store/       Chroma 向量库：存入、检索、过滤、分片
├── 03-rag-chain/          完整 RAG 链：LCEL 组装，含带溯源版本
├── 04-rag-advanced/       进阶技巧：查询改写、多路召回、重排序
├── 05-vue-rag-app/        Vue3 完整 RAG 应用（文档管理 + 问答）
└── 06-react-rag-app/      React 版 RAG 应用
```

## 前置依赖

```bash
# 启动 Chroma 向量数据库
docker run -d -p 8000:8000 chromadb/chroma

# 环境变量
cp .env.example .env
# 填入 OPENAI_API_KEY（embedding）和 DEEPSEEK_API_KEY（对话）
```

## 运行

```bash
# 示例脚本
cd 01-embedding-basics && npm install && node index.js

# 完整 RAG 应用后端
cd 05-vue-rag-app && npm install && node server.js
# 访问 http://localhost:3000
```
