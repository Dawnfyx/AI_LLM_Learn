# 第一章配套代码：大模型应用开发概述

LLM大模型Agent应用开发实战视频课程VIP--看课流程(里面有 视频教程+ 实战文档 + 源码 )
https://www.yuque.com/g/sohucw/fzhtfn/collaborator/join?token=FE9Wa1rzYBgxM73N&source=book_collaborator# L
LM大模型Agent应用开发实战课程VIP（持续加餐中)

https://www.yuque.com/sohucw/ct026l/uog3ytgagacchsdh?singleDoc# 《3.16号面试题总结&答案》 密码：gadt







我来帮你总结这个项目。首先让我查看项目的结构和关键文件来了解项目的全貌。




toolName: view_folder

status: success

/Users/fangyaxi/00work/GithubProjects/fanxing/sqlchat-main




toolName: file_search

status: success





toolName: file_search

status: success


让我继续查看项目的核心信息：




toolName: view_files

status: success


filePath: /Users/fangyaxi/00work/GithubProjects/fanxing/sqlchat-main/README.md




toolName: view_files

status: success


filePath: /Users/fangyaxi/00work/GithubProjects/fanxing/sqlchat-main/package.json




toolName: view_folder

status: success

/Users/fangyaxi/00work/GithubProjects/fanxing/sqlchat-main/src

# SQL Chat 项目总结

## 一、项目概述

**SQL Chat** 是一款基于聊天界面的 SQL 客户端工具，允许用户通过自然语言与数据库进行交互，实现数据库的查询、修改、添加和删除等操作。

## 二、核心定位

- **目标**: 进入"开发者工具 2.0 时代"，用聊天界面重构传统 SQL 客户端
- **理念**: 相比传统 UI 控件导航，聊天界面更加直观自然

## 三、技术架构

### 技术栈

| 分类 | 技术 |
|------|------|
| 前端框架 | Next.js 13+ |
| 状态管理 | Zustand |
| UI 组件 | MUI 5、HeadlessUI、Radix UI |
| 样式方案 | Tailwind CSS 3、Styled Components |
| 认证系统 | NextAuth |
| ORM | Prisma |
| AI 能力 | OpenAI API（支持 Ollama 自托管） |

### 支持的数据库

- MySQL、PostgreSQL、MSSQL、TiDB Cloud、OceanBase

## 四、项目结构

```
src/
├── components/          # UI组件（聊天视图、侧边栏、设置等）
├── pages/              # Next.js页面和API路由
│   └── api/            # 后端API（认证、支付、聊天、连接管理）
├── lib/connectors/     # 数据库连接器（mysql/postgres/mssql）
├── store/              # Zustand状态管理（连接、会话、设置等）
├── utils/              # 工具函数（OpenAI、SQL处理、执行引擎）
├── locales/            # 国际化翻译（英/中/西语）
└── types/              # TypeScript类型定义
```

## 五、核心功能

1. **自然语言转 SQL**: 用户输入自然语言，系统自动生成并执行 SQL
2. **多数据库连接管理**: 支持多种数据库类型的连接配置和切换
3. **会话管理**: 聊天历史记录、多标签会话
4. **结果可视化**: 查询结果以表格形式展示
5. **Schema 查看**: 数据库表结构浏览
6. **多语言支持**: 英语、中文、西班牙语
7. **主题切换**: 深色/浅色模式

## 六、部署方式

### 1. Vercel 一键部署

支持直接通过 Vercel 平台部署，需配置 `OPENAI_API_KEY` 环境变量。

### 2. Docker 自托管

```bash
docker run --name sqlchat --platform linux/amd64 \
  --env NEXTAUTH_SECRET="$(openssl rand -hex 5)" \
  --env OPENAI_API_KEY=<<YOUR OPENAI KEY>> \
  -p 3000:3000 --hostname localhost sqlchat/sqlchat
```

### 3. 本地开发

```bash
pnpm i
pnpm prisma generate
cp .env.usedb .env  # 或 .env.nodb
pnpm dev
```

## 七、配置选项

| 环境变量 | 说明 |
|----------|------|
| `OPENAI_API_KEY` | OpenAI API 密钥 |
| `OPENAI_API_ENDPOINT` | 自定义 API 端点（支持 Ollama） |
| `NEXT_PUBLIC_USE_DATABASE` | 是否启用用户账户系统 |
| `DATABASE_URL` | 元数据库连接（PostgreSQL） |

## 八、特色亮点

- **AI 驱动**: 基于大语言模型实现自然语言到 SQL 的转换
- **灵活部署**: 支持 SaaS（sqlchat.ai）和自托管两种模式
- **数据隐私**: 提供隐私政策保障用户数据安全
- **社区活跃**: 有 Twitter 和微信社区支持

该项目由 Bytebase 公司赞助，是一款面向开发者的现代化数据库交互工具。
        