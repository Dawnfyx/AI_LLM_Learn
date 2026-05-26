# 01-docker-deploy/Dockerfile
# 多阶段构建：先构建，再运行，镜像更小
FROM node:20-alpine AS builder

WORKDIR /app

# 先复制 package.json，利用 Docker 层缓存
# 依赖没变就不重新 npm install
COPY package*.json ./
RUN npm ci --only=production

# 再复制源码
COPY src/ ./src/

# ────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# 非 root 用户运行，提高安全性
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# 从 builder 阶段复制产物
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/src ./src
COPY --chown=appuser:appgroup package.json ./

USER appuser

# 环境变量
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/index.js"]
