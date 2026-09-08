# spec-phase9-docker-deploy.md

## 阶段前提

1. Phase8 完成：前端 UI 就绪，端到端链路（CLI → API → DB → 缓存 → 前端）全部打通，三个接口可稳定调用。
2. 本阶段**不改动多 Agent 架构**（1 主控 + 4 子 Agent）、**不修改 LangGraph 工作流图结构**。
3. 本阶段**不修改**后端 API 的请求/响应格式、不修改数据库 Schema、不修改缓存策略、不修改前端业务逻辑。
4. 本阶段仅新增 Docker 容器化与编排文件，实现一键部署完整应用。

## 阶段目标

通过 **Docker 多阶段构建 + docker-compose 编排**，将旅行规划助手（API + Web + PostgreSQL + Redis）打包为可一键启动的容器化应用，实现：

1. **API 容器化**：Hono 服务打包为 Docker 镜像，启动时自动同步数据库 Schema。
2. **Web 容器化**：前端静态资源由 Nginx 托管，Nginx 同时反向代理 `/api` 到 API 容器。
3. **基础设施容器化**：PostgreSQL 与 Redis 作为独立服务，数据持久化到 Docker Volume。
4. **一键启动**：`docker compose up --build` 即可启动完整应用，访问 `http://localhost:8080` 使用。
5. **健康检查与依赖编排**：API 等待数据库与缓存就绪后启动，Web 等待 API 就绪后启动。

**核心原则：只加部署文件，不改业务代码；容器内环境变量由 docker-compose 注入，不依赖 .env 文件。**

## 技术栈与依赖版本锁定

> 所有 Docker 基础镜像版本均通过 Docker Hub 实时查询确认（查询日期：2026-09-08）。
> 本阶段**不新增任何 npm 依赖**，仅新增 Docker 相关配置文件。

### Docker 基础镜像

| 镜像 | 版本 | 用途 |
|---|---|---|
| node | 24-alpine | API 与 Web 的构建/运行基础镜像（Node 24 LTS，代号 Krypton） |
| nginx | stable-alpine | Web 静态服务器 + API 反向代理（Nginx 1.30.x stable） |
| postgres | 18-alpine | PostgreSQL 数据库（18.6） |
| redis | 8-alpine | Redis 缓存（8.6.x） |

### 包管理器

- pnpm：通过 `corepack` 启用，使用最新稳定版（`corepack prepare pnpm@latest --activate`）。

### 不新增的依赖

- ❌ 不新增任何 npm 运行时依赖
- ❌ 不引入进程管理工具（pm2 等），直接用 `node` 启动
- ❌ 不引入反向代理以外的中间件（API 用 Nginx 反代即可）
- ❌ 不引入 Docker Compose 以外的编排工具（K8s 等）

## 目标目录结构

```
travel-plan-assistant/
├── Dockerfile.api                  # 新增：API 服务多阶段构建
├── Dockerfile.web                  # 新增：Web 前端多阶段构建
├── docker-compose.yml              # 新增：编排 api + web + postgres + redis
├── .dockerignore                   # 新增：Docker 构建上下文排除规则
├── apps/
│   ├── api/
│   │   ├── entrypoint.sh           # 新增：API 容器启动脚本（db push + 启动服务）
│   │   └── ...                     # 其余不变
│   └── web/
│       ├── nginx.conf              # 新增：Nginx 配置（静态托管 + /api 反代）
│       └── ...                     # 其余不变
├── .env.example                    # 修改：补充容器部署相关说明
└── spec/
    └── spec-phase9-docker-deploy.md
```

## Dockerfile.api（API 服务多阶段构建）

### 设计要点

- **builder 阶段**：基于 `node:24-alpine`，安装 pnpm，复制整个 monorepo，安装依赖并构建所有 workspace 包（含 `prisma generate`）。
- **runner 阶段**：基于 `node:24-alpine`，从 builder 复制完整的 `/app`（含 `node_modules` 与各包 `dist`），通过 entrypoint 脚本先执行 `prisma db push` 同步 Schema，再启动 API 服务。
- runner 阶段保留全部依赖（含 devDependencies 中的 `prisma`），以支持容器启动时执行 `prisma db push`。

```dockerfile
# ============================================
# API 服务 Dockerfile（多阶段构建）
# ============================================

# ---- 构建阶段 ----
FROM node:24-alpine AS builder

WORKDIR /app

# 启用 pnpm（通过 corepack）
RUN corepack enable && corepack prepare pnpm@latest --activate

# 复制整个 monorepo（.dockerignore 已排除 node_modules/dist/.env 等）
COPY . .

# 安装全部依赖（含 devDependencies，用于构建与 prisma）
RUN pnpm install --frozen-lockfile

# 构建所有 workspace 包（shared/llm/mock-data/agents + api）
# apps/api 的 build 脚本内含 prisma generate
RUN pnpm build

# ---- 运行阶段 ----
FROM node:24-alpine AS runner

WORKDIR /app

# 启用 pnpm（entrypoint 中需调用 pnpm prisma:push）
RUN corepack enable && corepack prepare pnpm@latest --activate

# 从 builder 复制完整项目（含 node_modules 与所有 dist 产物）
COPY --from=builder /app /app

# 复制 entrypoint 启动脚本
COPY apps/api/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# 环境变量
ENV NODE_ENV=production
ENV PORT=3000

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

# 启动
ENTRYPOINT ["/app/entrypoint.sh"]
```

> 说明：runner 阶段复制了整个 `/app`（含 `node_modules`），镜像体积较大但简单可靠。`prisma generate` 已在 builder 阶段执行，且 builder 与 runner 均为 `node:24-alpine`（同平台），Prisma Client 二进制可直接复用。

## entrypoint.sh（API 容器启动脚本）

位于 `apps/api/entrypoint.sh`，容器启动时执行：先同步数据库 Schema，再启动 API 服务。

```sh
#!/bin/sh
set -e

echo "[entrypoint] 同步数据库 Schema (prisma db push)..."
cd /app/apps/api
pnpm prisma:push

echo "[entrypoint] 启动 API 服务..."
cd /app
exec node apps/api/dist/index.js
```

> 说明：
> - `set -e`：任一命令失败则退出容器。
> - `pnpm prisma:push` 在 `apps/api` 目录下执行，会读取 `apps/api/prisma/schema.prisma` 与 `prisma.config.ts`，使用 `DATABASE_URL` 环境变量连接数据库。
> - `exec node ...`：用 exec 替换 shell 进程，确保信号（如 SIGTERM）能正确传递给 node 进程。

## Dockerfile.web（Web 前端多阶段构建）

### 设计要点

- **builder 阶段**：基于 `node:24-alpine`，安装 pnpm，复制整个 monorepo，安装依赖并构建 Web 前端（产出 `apps/web/dist`）。
- **runner 阶段**：基于 `nginx:stable-alpine`，复制构建产物与自定义 Nginx 配置。

```dockerfile
# ============================================
# Web 前端 Dockerfile（多阶段构建）
# ============================================

# ---- 构建阶段 ----
FROM node:24-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY . .

RUN pnpm install --frozen-lockfile

# 构建 Web 前端（依赖 @travel/shared 类型，pnpm 会自动构建依赖）
RUN pnpm --filter @travel/web build

# ---- 运行阶段 ----
FROM nginx:stable-alpine AS runner

# 复制前端构建产物到 Nginx 静态目录
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

# 复制自定义 Nginx 配置
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

# 健康检查
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=5 \
  CMD wget -qO- http://localhost:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
```

## nginx.conf（Web 容器 Nginx 配置）

位于 `apps/web/nginx.conf`，实现：
1. 托管前端静态文件。
2. SPA 路由 fallback（刷新页面不 404）。
3. `/api/` 反向代理到 API 容器 `http://api:3000`。

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name _;

    # 静态文件根目录
    root /usr/share/nginx/html;
    index index.html;

    # gzip 压缩
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript image/svg+xml;
    gzip_min_length 1024;

    # SPA 路由 fallback：未匹配到静态文件时返回 index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API 反向代理：将 /api/* 转发到 API 容器
    location /api/ {
        proxy_pass http://api:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # llm 模式规划可能耗时较长，放宽超时
        proxy_read_timeout 300s;
        proxy_connect_timeout 10s;
    }
}
```

> 说明：
> - `proxy_pass http://api:3000`：`api` 是 docker-compose 中 API 服务的名称，Docker 内部 DNS 会解析为 API 容器 IP。
> - `location /api/` 匹配 `/api/` 开头的请求，转发时保留路径（`/api/plan` → `http://api:3000/api/plan`）。
> - `proxy_read_timeout 300s`：llm 模式下规划可能耗时较长，避免 Nginx 提前断开。

## docker-compose.yml（编排文件）

位于项目根目录，编排 4 个服务：`postgres`、`redis`、`api`、`web`。

```yaml
services:
  # ------------------------------------------
  # PostgreSQL 数据库
  # ------------------------------------------
  postgres:
    image: postgres:18-alpine
    container_name: travel-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: travel_plan
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d travel_plan"]
      interval: 5s
      timeout: 5s
      retries: 10

  # ------------------------------------------
  # Redis 缓存
  # ------------------------------------------
  redis:
    image: redis:8-alpine
    container_name: travel-redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 10

  # ------------------------------------------
  # API 服务
  # ------------------------------------------
  api:
    build:
      context: .
      dockerfile: Dockerfile.api
    container_name: travel-api
    restart: unless-stopped
    environment:
      NODE_ENV: production
      PORT: "3000"
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/travel_plan
      REDIS_URL: redis://redis:6379
      DOUBAO_API_KEY: ${DOUBAO_API_KEY:-}
      DOUBAO_MODEL: ${DOUBAO_MODEL:-doubao-seed-2.1-turbo}
      DOUBAO_BASE_URL: ${DOUBAO_BASE_URL:-https://ark.cn-beijing.volces.com/api/plan/v3}
    ports:
      - "3000:3000"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  # ------------------------------------------
  # Web 前端
  # ------------------------------------------
  web:
    build:
      context: .
      dockerfile: Dockerfile.web
    container_name: travel-web
    restart: unless-stopped
    ports:
      - "8080:80"
    depends_on:
      - api

volumes:
  postgres_data:
  redis_data:
```

### 关键设计说明

| 配置项 | 说明 |
|---|---|
| `depends_on.condition: service_healthy` | API 等待 postgres 和 redis 的 healthcheck 通过后才启动，避免数据库未就绪导致启动失败 |
| `DATABASE_URL` | 主机名使用 `postgres`（compose 服务名），端口 `5432` |
| `REDIS_URL` | 主机名使用 `redis`（compose 服务名），端口 `6379` |
| `DOUBAO_API_KEY` | 通过 `${DOUBAO_API_KEY:-}` 从宿主机环境变量或根目录 `.env` 读取，默认为空（空时 llm 模式不可用，mock 模式正常） |
| `ports` | postgres 5432、redis 6379、api 3000 均映射到宿主机，方便调试；web 通过 8080 访问 |
| `volumes` | postgres_data 与 redis_data 持久化数据，容器重建不丢失 |
| `restart: unless-stopped` | 容器异常退出时自动重启，手动停止则不重启 |

## .dockerignore

位于项目根目录，排除不需要进入 Docker 构建上下文的文件，减小上下文体积、加速构建。

```
# 依赖
node_modules
**/node_modules
.pnpm-store

# 构建产物
dist
**/dist
build
**/build
*.tsbuildinfo

# 环境变量（禁止打包进镜像）
.env
.env.local
.env.*.local

# 日志
*.log
npm-debug.log*
pnpm-debug.log*

# 编辑器
.vscode
.idea
*.swp
*.swo

# 系统
.DS_Store
Thumbs.db

# 版本控制
.git
.gitignore

# 测试与覆盖率
coverage
.nyc_output

# AI 工具
.trae
.cursor

# 其他
redis-mock.js
```

> 说明：`.env` 必须排除，禁止将密钥打包进镜像。容器运行时环境变量由 docker-compose 注入。

## 环境变量

### 容器内环境变量来源

容器内**不使用 .env 文件**，所有环境变量通过 `docker-compose.yml` 的 `environment` 注入：

| 变量 | 来源 | 默认值 | 说明 |
|---|---|---|---|
| NODE_ENV | compose 写死 | production | Node 运行环境 |
| PORT | compose 写死 | 3000 | API 监听端口 |
| DATABASE_URL | compose 写死 | postgresql://postgres:postgres@postgres:5432/travel_plan | 数据库连接 |
| REDIS_URL | compose 写死 | redis://redis:6379 | Redis 连接 |
| DOUBAO_API_KEY | 宿主机 `.env` / 环境变量 | 空 | 豆包 API 密钥（llm 模式必需） |
| DOUBAO_MODEL | 宿主机 `.env` / 环境变量 | doubao-seed-2.1-turbo | 豆包模型名 |
| DOUBAO_BASE_URL | 宿主机 `.env` / 环境变量 | https://ark.cn-beijing.volces.com/api/plan/v3 | 豆包接口地址 |

### .env.example 更新

在 `.env.example` 中补充容器部署说明（不新增变量，仅加注释）：

```
# ============================================
# Docker 部署说明
# ============================================
# 使用 docker compose 部署时，本文件会被 docker-compose 自动读取，
# 用于注入 DOUBAO_API_KEY 等敏感变量。
# DATABASE_URL / REDIS_URL 已在 docker-compose.yml 中写死（指向容器内服务），
# 无需在此配置。
#
# 启动命令：
#   docker compose up --build
# 访问地址：
#   http://localhost:8080
```

## scripts（根 package.json）

新增便捷脚本（可选，非必需）：

```json
{
  "scripts": {
    "docker:up": "docker compose up --build",
    "docker:down": "docker compose down",
    "docker:logs": "docker compose logs -f",
    "docker:clean": "docker compose down -v"
  }
}
```

| 脚本 | 说明 |
|---|---|
| `docker:up` | 构建并启动所有容器 |
| `docker:down` | 停止并删除容器（保留数据卷） |
| `docker:logs` | 查看所有容器日志 |
| `docker:clean` | 停止并删除容器及数据卷（清空数据库与缓存数据） |

## 使用流程

### 1. 准备环境变量

复制 `.env.example` 为 `.env`，填入 `DOUBAO_API_KEY`（如需使用 llm 模式）：

```bash
cp .env.example .env
# 编辑 .env，填入 DOUBAO_API_KEY
```

> mock 模式无需填写 `DOUBAO_API_KEY`。

### 2. 启动应用

```bash
docker compose up --build
```

首次启动会：
1. 构建 API 镜像与 Web 镜像。
2. 启动 postgres 与 redis 容器。
3. postgres/redis 健康检查通过后，启动 API 容器（自动执行 `prisma db push` 建表）。
4. API 就绪后，启动 Web 容器。

### 3. 访问应用

- 前端界面：http://localhost:8080
- API 健康检查：http://localhost:3000/api/health
- API 规划接口：POST http://localhost:3000/api/plan

### 4. 停止与清理

```bash
# 停止容器（保留数据）
docker compose down

# 停止并清空所有数据（数据库 + 缓存）
docker compose down -v
```

## ✅ 本阶段交付标准

1. `Dockerfile.api`、`Dockerfile.web`、`docker-compose.yml`、`.dockerignore`、`apps/api/entrypoint.sh`、`apps/web/nginx.conf` 六个文件创建完成。
2. `docker compose build` 成功构建 API 与 Web 镜像，无报错。
3. `docker compose up` 启动后，4 个容器（postgres、redis、api、web）均为 healthy/running 状态。
4. API 容器启动时自动执行 `prisma db push`，数据库 `travel_plan` 中创建 `TravelPlan` 表。
5. 访问 `http://localhost:8080` 可打开前端规划页面。
6. 前端页面提交 mock 模式规划，成功返回并展示规划结果（机票、酒店、行程、预算）。
7. 前端页面可查看历史列表与详情（数据持久化到 postgres_data 卷）。
8. 配置 `DOUBAO_API_KEY` 后，llm 模式可正常调用。
9. 停止容器后重启（`docker compose up`，不带 `--build`），数据不丢失。
10. `docker compose down -v` 后重新启动，数据库为空，可重新规划。
11. 后端 API 代码零改动，Agent 调度逻辑零改动，数据库 Schema 零改动，缓存策略零改动，前端业务代码零改动。

## ❌ Phase9 禁止清单

1. ❌ 禁止新增/删减 Agent 角色，禁止修改 LangGraph 调度流程图。
2. ❌ 禁止修改后端 API 的请求/响应格式。
3. ❌ 禁止修改数据库 Schema、Prisma 模型。
4. ❌ 禁止修改缓存策略、Redis 配置。
5. ❌ 禁止修改前端业务逻辑（仅允许新增 nginx.conf 部署配置）。
6. ❌ 禁止新增任何 npm 依赖（Docker 部署不引入新运行时库）。
7. ❌ 禁止将 `.env` 或密钥打包进 Docker 镜像（必须通过 .dockerignore 排除）。
8. ❌ 禁止在容器内使用 `prisma migrate`（本阶段沿用 `prisma db push`，不引入迁移体系）。
9. ❌ 禁止引入 K8s、Swarm 等编排工具（仅用 docker-compose）。
10. ❌ 禁止修改根目录的 tsconfig.base.json、pnpm-workspace.yaml 等配置文件。
11. ❌ 禁止实现多副本、负载均衡等生产级特性（本阶段为单实例部署）。

## 实施中发现的关键修复（已验证）

以下三个问题在首次 `docker compose build/up` 时暴露，已修复并验证通过。
> 说明：对 `pnpm-workspace.yaml`、`.npmrc`、`docker-compose.yml`、`nginx.conf` 的修改均为 Docker 部署成功所必需的最小改动，不属于禁止清单中"随意修改配置文件"的范畴。

### 1. pnpm 12 构建脚本审批（ERR_PNPM_IGNORED_BUILDS）

容器内通过 `corepack prepare pnpm@latest --activate` 安装的 pnpm 12.x 默认禁止所有依赖的构建脚本，需显式批准。`@prisma/engines` 需要运行构建脚本下载 Prisma 引擎二进制文件。

**修复**：在 `pnpm-workspace.yaml` 的 `onlyBuiltDependencies` 与 `allowBuilds` 中添加 `@prisma/engines`，同时在 `.npmrc` 中添加 `only-built-dependencies[]=@prisma/engines`。

```yaml
# pnpm-workspace.yaml
onlyBuiltDependencies:
  - esbuild
  - prisma
  - '@prisma/engines'

allowBuilds:
  esbuild: true
  prisma: true
  '@prisma/engines': true
```

```ini
# .npmrc
only-built-dependencies[]=esbuild
only-built-dependencies[]=prisma
only-built-dependencies[]=@prisma/engines
```

### 2. PostgreSQL 18 数据卷挂载路径

PostgreSQL 18+ Docker 镜像将数据存储在版本特定子目录（如 `/var/lib/postgresql/18/docker`），不再使用旧的 `/var/lib/postgresql/data`。若挂载到旧路径会导致容器启动失败。

**修复**：将 docker-compose.yml 中 postgres 的数据卷挂载路径从 `/var/lib/postgresql/data` 改为 `/var/lib/postgresql`。

### 3. Nginx 需同时监听 IPv6

容器内 `/etc/hosts` 中 `localhost` 同时解析到 IPv4 `127.0.0.1` 与 IPv6 `::1`。若 nginx 仅监听 IPv4，健康检查 `wget http://localhost:80/` 会因优先尝试 IPv6 而失败（容器 unhealthy）。

**修复**：在 nginx.conf 中添加 `listen [::]:80;`，同时监听 IPv4 与 IPv6。

## 工作流强制规则

1. 增量开发：创建 `.dockerignore` → 编写 `Dockerfile.api` + `entrypoint.sh` → 编写 `Dockerfile.web` + `nginx.conf` → 编写 `docker-compose.yml` → 更新 `.env.example` 与 scripts → 验证。
2. 优先验证 mock 模式完整链路（前端 → API → DB → 缓存 → 前端展示），再验证 llm 模式。
3. 必须验证数据持久化：`docker compose down` 后重启，历史规划记录不丢失。
4. 必须验证敏感信息不泄露：`.env` 不出现在镜像中（可用 `docker run --rm <api-image> cat .env` 验证文件不存在）。
5. 任何超出本 Spec 范围的改动（如加迁移体系、加 K8s、加负载均衡），停止开发，等待确认。
