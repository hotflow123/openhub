# syntax=docker/dockerfile:1.7
# OpenHub 单镜像：构建 server（Node 22 + tsx），前端由 nginx 提供

# ---- 前端构建阶段 ----
FROM node:22-alpine AS web-build
WORKDIR /app
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/web/package.json packages/web/
COPY packages/catalog/package.json packages/catalog/
RUN corepack enable && corepack prepare [email protected] --activate && \
    pnpm install --filter @openhub/web... --frozen-lockfile=false
COPY packages/web/ packages/web/
RUN pnpm --filter @openhub/web build

# ---- 后端镜像 ----
FROM node:22-alpine
WORKDIR /app
RUN corepack enable && corepack prepare [email protected] --activate && \
    npm install -g pnpm@9

# 复制 manifests，先装依赖（缓存友好）
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/server/package.json packages/server/
COPY packages/catalog/package.json packages/catalog/
RUN pnpm install --filter @openhub/server... --frozen-lockfile=false

# 复制源码
COPY packages/server/ packages/server/
COPY packages/catalog/ packages/catalog/
# 把前端构建产物复制进后端静态目录
COPY --from=web-build /app/packages/web/dist packages/server/public

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

WORKDIR /app/packages/server
CMD ["pnpm", "start"]
