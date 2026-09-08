#!/bin/sh
set -e

echo "[entrypoint] 同步数据库 Schema (prisma db push)..."
cd /app/apps/api
pnpm prisma:push

echo "[entrypoint] 启动 API 服务..."
cd /app
exec node apps/api/dist/index.js
