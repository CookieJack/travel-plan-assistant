# 多 Agent 旅行规划助手（Travel Plan Assistant）

基于 **LangGraph 多智能体调度** 的旅行规划助手。用户输入旅行需求（支持自然语言），系统通过「意图识别 → 机票 / 酒店 / 游玩活动 / 预算 4 个子 Agent 并行执行 → 主控汇总」的完整链路，输出结构化旅行方案。

## 功能特性

- **多智能体编排**：1 个主控（Travel Supervisor）+ 4 个专业子 Agent + 1 个意图识别前置节点
- **双模式运行**：`mock` 模式（模拟数据，开箱即用）与 `llm` 模式（豆包大模型真实生成）
- **自然语言对话**：意图识别与信息抽取，缺失字段自动追问澄清
- **多城市行程**：支持多目的地、多行程天数拆分
- **流式输出**：SSE 实时推送执行进度、工具调用与最终规划
- **规划修订**：对已生成的规划反馈修订
- **用户系统**：注册 / 登录、Token 鉴权、个性化偏好（出行风格 / 预算上限自动带入）
- **会话存储**：历史会话与消息持久化、会话切换恢复
- **缓存加速**：Redis 缓存规划结果

## 技术栈

| 层 | 技术 |
|---|---|
| 语言 | TypeScript |
| 调度 | LangGraph（@langchain/langgraph） |
| 后端 | Hono |
| 数据库 | PostgreSQL + Prisma ORM |
| 缓存 | Redis |
| 前端 | React 19 + Vite + Tailwind CSS + shadcn/ui |
| 大模型 | 豆包（字节方舟 OpenAI 兼容接口） |
| 部署 | Docker Compose + Nginx |

## 目录结构（pnpm monorepo）

```
travel-plan-assistant/
├── apps/
│   ├── api/       # Hono 后端服务（REST + SSE + Prisma）
│   ├── web/       # React 前端
│   └── cli/       # 命令行版旅行规划助手
├── packages/
│   ├── agents/    # 多智能体实现（supervisor / flight / hotel / activities / budgeting / intent）
│   ├── llm/       # 豆包大模型接入封装
│   ├── mock-data/ # 模拟数据
│   └── shared/    # 共享类型 / zod schema / 工具函数
└── docker-compose.yml
```

## 环境要求

- Node.js ≥ 18
- pnpm ≥ 12
- PostgreSQL、Redis（本地开发时需要；也可只使用 Docker 部署方案）
- 可选：Docker 与 Docker Compose

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

按需修改 `.env` 中的配置项（详见下方「环境变量」）。**仅使用 `mock` 模式时可不填 `DOUBAO_API_KEY`。**

> 注意：`.env` 已被 `.gitignore` 忽略，请勿提交到仓库。

### 3. 初始化数据库

需要本地 PostgreSQL 已启动，且 `DATABASE_URL` 指向正确的库：

```bash
pnpm db:push
```

### 4. 启动服务

```bash
pnpm dev:api   # API 服务 → http://localhost:3000
pnpm dev:web   # 前端 → http://localhost:5173
pnpm dev       # CLI 命令行
```

## CLI 使用

```bash
pnpm dev
```

启动后输入旅行需求，例如：

```
后天去西安玩3天再去成都玩2天
```

CLI 默认使用 `mock` 模式；如需大模型生成，配置好 `DOUBAO_API_KEY` 后切换为 `llm` 模式。

## Docker 部署

```bash
docker compose up --build
```

部署内容：

- `postgres`（PostgreSQL 18，端口 5432）
- `redis`（Redis 8，端口 6379）
- `api`（Hono 服务，端口 3000）
- `web`（Nginx + 前端静态资源，端口 8080）

启动完成后访问 **http://localhost:8080**。

说明：

- 容器启动时会自动执行 `prisma db push` 初始化数据库表结构
- 数据库与 Redis 数据通过命名卷持久化（`postgres_data` / `redis_data`）
- `DOUBAO_API_KEY` 通过 `.env` 注入容器，请提前配置

常用命令：

```bash
docker compose up --build   # 构建并启动
docker compose down         # 停止
docker compose logs -f      # 查看日志
docker compose down -v      # 停止并清除数据卷
```

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `DOUBAO_API_KEY` | llm 模式必填 | 豆包（字节方舟）API 密钥 |
| `DOUBAO_MODEL` | 否 | 模型名或接入点 ID（默认 `doubao-seed-2.1-turbo`） |
| `DOUBAO_BASE_URL` | 否 | 字节方舟兼容接口地址（默认无需修改） |
| `DATABASE_URL` | 是 | PostgreSQL 连接串（如 `postgresql://postgres:postgres@localhost:5432/travel_plan`） |
| `REDIS_URL` | 是 | Redis 连接串（如 `redis://localhost:6379`） |

## API 概览

| 接口 | 说明 |
|---|---|
| `GET /api/health` | 健康检查 |
| `POST /api/plan` | 生成规划（结构化 JSON，支持 `mode: mock/llm`） |
| `POST /api/plan/stream` | 生成规划（SSE 流式，含追问 / 进度 / 工具调用） |
| `POST /api/plans/:id/revise` | 修订规划 |
| `GET /api/plans` / `GET /api/plans/:id` | 规划列表 / 详情 |
| `POST /api/auth/register` / `login` | 注册 / 登录 |
| `GET /api/user` / `PUT /api/user` | 用户偏好读取 / 更新 |
| `GET /api/conversations` | 会话列表 |
| `GET /api/conversations/:id` | 会话详情（含消息） |
| `DELETE /api/conversations/:id` | 删除会话 |