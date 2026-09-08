# spec-phase6-prisma-postgres.md

## 阶段前提

1. Phase5 完成：Hono API 服务就绪，`POST /api/plan` 可生成旅行方案（mock/llm 双模式，text/markdown/json 三格式）。
2. 本阶段**不改动多 Agent 架构**（1 主控 + 4 子 Agent）、**不修改 LangGraph 工作流图结构**。
3. 本阶段**不引入**缓存（Phase7）、前端 UI（Phase8）。
4. 本阶段仅新增数据库持久化能力，不修改 Agent 内部业务逻辑。

## 阶段目标

引入 **Prisma ORM + PostgreSQL**，将每次生成的旅行规划结果持久化到数据库，并提供历史规划查询 API，使前端（Phase8）可浏览和回顾历史方案。

**核心原则：只加持久化层，不改 Agent 调度逻辑，不改变现有 API 响应格式。**

## 技术栈与依赖版本锁定

> 所有版本均通过 `npm view` 实时查询确认。
> Prisma `latest` 标签为 `8.0.0-rc.13`（RC 预发布），本阶段锁定最新稳定版 `7.10.0`。

### 本阶段新增依赖

| 包 | 版本 | 用途 |
|---|---|---|
| prisma | ^7.10.0 | ORM 工具链（schema 定义、迁移、client 生成） |
| @prisma/client | ^7.10.0 | 运行时数据库客户端 |
| @prisma/adapter-pg | 7.10.0 | Prisma 7 PostgreSQL 驱动适配器（Prisma 7 必须使用适配器连接） |
| pg | 8.23.0 | Node.js PostgreSQL 客户端（适配器底层依赖） |
| @types/pg | 8.23.1 | pg 的 TypeScript 类型定义（devDep） |

> **Prisma 7 重大变更**：`datasource.url` 不再支持，需通过 `prisma.config.ts` 配置；`PrismaClient` 构造函数必须传入 `adapter`（驱动适配器），不再支持直连。

### 复用已有 workspace 包

| 包 | 用途 |
|---|---|
| @travel/agents | 提供 `buildTravelGraph()` |
| @travel/llm | 提供 `setMode()` |
| @travel/shared | 提供 `TravelRequest`、`TravelState` 等类型 |

### 不新增的依赖

- ❌ 不引入 ioredis（Phase7 范围）
- ❌ 不引入 zod/ajv 等校验库（Phase5 沿用手写校验）
- ❌ 不引入日志库（用 console）
- ❌ 不引入前端依赖（Phase8 范围）

## 数据库 Schema 设计

### 设计原则

- 核心查询字段（目的地、天数、出行日期、预算等）单独列，便于索引与过滤。
- 嵌套结构（机票方案、酒店方案、每日行程、预算明细）使用 PostgreSQL `Json` 列存储，避免过度规范化，保持与 `TravelState` 结构对齐。
- 记录生成模式（mock/llm），便于后续区分数据来源。

### prisma/schema.prisma

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
}

model TravelPlan {
  id              String    @id @default(cuid())
  destination     String
  days            Int
  travelDate      String
  userPreference  String?
  budgetLimit     Float?
  travelStyle     String?
  mode            String    // "mock" | "llm"
  flights         Json?     // FlightResult
  hotels          Json?     // HotelResult
  activities      Json?     // ActivitiesResult
  budget          Json?     // BudgetResult
  summary         String?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@index([destination])
  @@index([createdAt])
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|---|---|---|
| id | String (cuid) | 主键 |
| destination | String | 目的地（索引） |
| days | Int | 出行天数 |
| travelDate | String | 出行日期 YYYY-MM-DD |
| userPreference | String? | 用户偏好 |
| budgetLimit | Float? | 预算上限 |
| travelStyle | String? | 出行风格 |
| mode | String | 生成模式：mock / llm |
| flights | Json? | 机票方案（FlightResult 结构） |
| hotels | Json? | 酒店方案（HotelResult 结构） |
| activities | Json? | 游玩行程（ActivitiesResult 结构） |
| budget | Json? | 预算汇总（BudgetResult 结构） |
| summary | String? | 主控汇总文本 |
| createdAt | DateTime | 创建时间（索引） |
| updatedAt | DateTime | 更新时间 |

## 目标目录结构

```
apps/api/
├── prisma/
│   └── schema.prisma          # Prisma Schema 定义（无 url，url 在 prisma.config.ts）
├── prisma.config.ts           # 新增：Prisma 7 配置文件（datasource.url）
├── src/
│   ├── index.ts               # Hono 入口（新增路由注册）
│   ├── routes/
│   │   ├── health.ts
│   │   ├── plan.ts            # 规划 + 持久化
│   │   └── plans.ts           # 历史列表 + 详情查询
│   ├── services/
│   │   ├── travelService.ts   # 规划生成（持久化逻辑）
│   │   └── dbService.ts       # 新增：数据库持久化与查询
│   ├── lib/
│   │   └── prisma.ts          # 新增：PrismaClient 单例（PrismaPg 适配器）
│   └── types/
│       └── api.ts
└── package.json
```

## Prisma 配置

### 1. prisma.config.ts（Prisma 7 新增）

Prisma 7 将 `datasource.url` 从 `schema.prisma` 移至配置文件：

```typescript
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/travel_plan',
  },
});
```

### 2. 生成 Prisma Client

```bash
npx prisma generate
```
将 `prisma generate` 加入 `build` 脚本，确保构建前 client 已生成。

### 3. 数据库迁移

开发环境使用 `prisma db push`（快速同步 schema 到数据库，不生成迁移文件）：
```bash
npx prisma db push
```

> 不使用 `prisma migrate dev`，因为本阶段为开发演示，无需迁移历史管理。生产部署阶段（Phase9+）再引入迁移。

## Prisma Client 单例（src/lib/prisma.ts）

Prisma 7 要求使用驱动适配器连接数据库：

```typescript
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' }),
    log: ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
```

> 单例模式避免开发环境热重载时创建过多数据库连接。
> `DATABASE_URL` 由根目录 `.env` 加载，API 入口 `index.ts` 中通过 `dotenv` 显式加载。

## 数据库服务（src/services/dbService.ts）

职责：封装 Prisma 调用，将 `TravelState` 转换为数据库记录并持久化，以及查询历史记录。

### 1. 保存规划结果

```typescript
async function savePlan(
  state: TravelState,
  mode: RunMode,
): Promise<TravelPlan>
```

- 从 `state.request` 提取核心字段
- 将 `state.flights`、`state.hotels`、`state.activities`、`state.budget`、`state.summary` 存入对应 Json/Text 列
- 返回新建记录的 `id`

### 2. 查询历史列表

```typescript
async function listPlans(
  page: number,
  pageSize: number,
  destination?: string,
): Promise<{ items: TravelPlan[]; total: number; page: number; pageSize: number }>
```

- 按 `createdAt` 降序排列
- 支持 `destination` 过滤（模糊匹配）
- 支持分页（page 从 1 开始）

### 3. 查询单个详情

```typescript
async function getPlanById(id: string): Promise<TravelPlan | null>
```

## API 设计

### 已有接口改动：POST /api/plan

**行为变更**：在返回规划结果之前，将结果持久化到数据库，并在响应中附带 `id` 和 `createdAt`。

**响应（200，format=json）**：
```json
{
  "id": "cmxxxxx...",
  "createdAt": "2026-09-06T12:00:00.000Z",
  "request": { ... },
  "flights": { ... },
  "hotels": { ... },
  "activities": { ... },
  "budget": { ... },
  "summary": "..."
}
```

**响应（200，format=text/markdown）**：
```json
{
  "id": "cmxxxxx...",
  "createdAt": "2026-09-06T12:00:00.000Z",
  "format": "text",
  "content": "..."
}
```

> 注意：持久化失败不应阻断规划结果返回。保存失败时仅记日志，仍正常返回规划结果（不影响核心功能）。

### 新增接口：GET /api/plans

查询历史规划列表。

**Query 参数**：

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| page | number | 否 | 1 | 页码（从 1 开始） |
| pageSize | number | 否 | 10 | 每页数量（最大 50） |
| destination | string | 否 | - | 按目的地过滤（模糊匹配） |

**响应（200）**：
```json
{
  "items": [
    {
      "id": "cmxxxxx...",
      "destination": "东京",
      "days": 5,
      "travelDate": "2026-10-01",
      "budgetLimit": 8000,
      "mode": "mock",
      "summary": "...",
      "createdAt": "2026-09-06T12:00:00.000Z"
    }
  ],
  "total": 25,
  "page": 1,
  "pageSize": 10
}
```

> 列表不返回 `flights`/`hotels`/`activities`/`budget` 等大字段，详情通过 `GET /api/plans/:id` 获取。

### 新增接口：GET /api/plans/:id

查询单个规划详情。

**响应（200）**：
```json
{
  "id": "cmxxxxx...",
  "destination": "东京",
  "days": 5,
  "travelDate": "2026-10-01",
  "userPreference": "美食",
  "budgetLimit": 8000,
  "travelStyle": "舒适",
  "mode": "mock",
  "flights": { ... },
  "hotels": { ... },
  "activities": { ... },
  "budget": { ... },
  "summary": "...",
  "createdAt": "2026-09-06T12:00:00.000Z",
  "updatedAt": "2026-09-06T12:00:00.000Z"
}
```

**错误响应（404）**：
```json
{
  "error": "规划记录不存在",
  "code": "NOT_FOUND"
}
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| DATABASE_URL | - | PostgreSQL 连接串，格式：`postgresql://user:password@localhost:5432/travel_plan?schema=public` |
| PORT | 3000 | HTTP 服务监听端口（沿用 Phase5） |
| NODE_ENV | development | 运行环境 |
| DOUBAO_API_KEY | - | 豆包密钥（沿用根 .env） |
| DOUBAO_MODEL | - | 豆包模型（沿用根 .env） |

`.env.example` 新增：
```
# PostgreSQL 数据库连接
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/travel_plan?schema=public
```

## scripts（apps/api/package.json）

```json
{
  "scripts": {
    "build": "tsup src/index.ts --format esm --out-dir dist --external dotenv",
    "dev": "tsup src/index.ts --format esm --out-dir dist --external dotenv --watch",
    "start": "node dist/index.js",
    "prisma:generate": "prisma generate",
    "prisma:push": "prisma db push",
    "prisma:studio": "prisma studio"
  }
}
```

根 `package.json` 新增脚本：
- `db:push`：`pnpm --filter @travel/api prisma:push`
- `db:studio`：`pnpm --filter @travel/api prisma:studio`

## ✅ 本阶段交付标准

1. `pnpm install` 成功，`prisma`、`@prisma/client`、`@prisma/adapter-pg`、`pg`、`@types/pg` 安装至 `apps/api`。
2. `npx prisma generate` 成功生成 Prisma Client。
3. 配置好 `DATABASE_URL` 后，`npx prisma db push` 成功在 PostgreSQL 创建 `TravelPlan` 表。
4. `POST /api/plan`（mock 模式）生成方案后，数据库新增一条记录。
5. `POST /api/plan?mode=llm` 生成方案后，数据库新增一条记录，`mode` 字段为 `llm`。
6. `GET /api/plans` 返回历史列表，支持分页和目的地过滤。
7. `GET /api/plans/:id` 返回完整规划详情；不存在的 id 返回 404。
8. `POST /api/plan` 响应中包含 `id` 和 `createdAt` 字段。
9. 持久化失败时不影响规划结果返回（仅记日志）。
10. Agent 调度逻辑零改动，工作流拓扑不变。

## ❌ Phase6 禁止清单

1. ❌ 禁止新增/删减 Agent 角色，禁止修改 LangGraph 调度流程图。
2. ❌ 禁止引入缓存客户端（Phase7 范围）。
3. ❌ 禁止开发前端页面（Phase8 范围）。
4. ❌ 禁止修改 Agent 内部业务逻辑、提示词、mock 数据生成规则。
5. ❌ 禁止引入除 `prisma`、`@prisma/client`、`@prisma/adapter-pg`、`pg` 以外的运行时依赖。
6. ❌ 禁止使用 `prisma migrate dev` 创建迁移文件（本阶段用 `db push`）。
7. ❌ 禁止对 `flights`/`hotels`/`activities`/`budget` 做表级规范化拆分（本阶段统一用 Json 列）。
8. ❌ 禁止新增用户体系、认证、权限相关功能。
9. ❌ 禁止删除或修改 Phase5 的 `POST /api/plan` 请求校验逻辑和响应结构（仅在响应中追加 `id`/`createdAt`）。

## 工作流强制规则

1. 增量开发：先装依赖 + 写 schema → 生成 client → 建 dbService → 改 plan 路由加持久化 → 加 plans 路由 → 验证。
2. 优先保证 mock 模式下的持久化跑通，再验证 llm 模式。
3. 任何超出本 Spec 范围的改动（如提前接 Redis、加用户登录、做数据可视化），停止开发，等待确认。
4. 数据库操作失败时，记录 `console.error`，不抛出异常阻断主流程。
