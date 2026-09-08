# spec-phase7-redis-cache.md

## 阶段前提

1. Phase6 完成：Prisma + PostgreSQL 持久化就绪，`POST /api/plan` 生成方案并落库，`GET /api/plans` 历史列表，`GET /api/plans/:id` 详情查询均可用。
2. 本阶段**不改动多 Agent 架构**（1 主控 + 4 子 Agent）、**不修改 LangGraph 工作流图结构**。
3. 本阶段**不引入**前端 UI（Phase8）。
4. 本阶段仅新增 Redis 缓存层，不修改 Agent 内部业务逻辑、不修改数据库 Schema。

## 阶段目标

引入 **Redis（ioredis）** 作为缓存层，对高频读接口和重复规划请求做缓存，降低 LLM 调用成本与数据库压力，提升接口响应速度。

**核心原则：只加缓存层，不改 Agent 调度逻辑，不改变现有 API 响应格式；Redis 不可用时自动降级，不阻断主流程。**

## 技术栈与依赖版本锁定

> 所有版本均通过 `npm view` 实时查询确认。
> ioredis `latest` 标签为 `6.0.0`，本阶段锁定 `^6.0.0`。

### 本阶段新增依赖

| 包 | 版本 | 用途 |
|---|---|---|
| ioredis | ^6.0.0 | Redis 客户端 |

### 复用已有 workspace 包

| 包 | 用途 |
|---|---|
| @travel/agents | 提供 `buildTravelGraph()` |
| @travel/llm | 提供 `setMode()` |
| @travel/shared | 提供 `TravelRequest`、`TravelState` 等类型 |

### 不新增的依赖

- ❌ 不引入新的前端依赖（Phase8 范围）
- ❌ 不引入新的校验库（沿用现有手写校验）
- ❌ 不引入新的日志库（用 console）

## 缓存策略设计

### 1. 规划结果缓存（POST /api/plan）

**目的**：避免相同请求参数重复触发 Agent 执行（尤其是 LLM 调用）。

**缓存键**：
```
plan:result:{hash}
```
其中 `hash` 为请求参数 + mode 的 SHA-256 摘要（取前 16 位）：
- 参数：`destination`、`days`、`travelDate`、`budget_limit`、`user_preference`、`travel_style`
- mode：`mock` / `llm`
- 可选字段缺失时用空字符串占位，保证键稳定

**缓存值**：`TravelState`（仅规划结果内容，不含 `id`/`createdAt`）。

**TTL**：
- mock 模式：3600 秒（1 小时）
- llm 模式：1800 秒（30 分钟）

**命中逻辑**：
1. 根据请求参数计算缓存键，查询 Redis。
2. 命中：直接使用缓存的 `TravelState`，**仍调用 `savePlan` 持久化**（产生新的 `id`/`createdAt`），跳过 Agent 执行。
3. 未命中：正常执行 Agent → 持久化 → 将 `TravelState` 写入缓存。

> 说明：缓存的是规划内容而非完整响应，保证每次请求仍生成新的数据库记录和 id。

### 2. 规划详情缓存（GET /api/plans/:id）

**目的**：减少详情查询的数据库压力。

**缓存键**：
```
plan:detail:{id}
```

**缓存值**：完整规划详情（含 flights/hotels/activities/budget 等 Json 字段）。

**TTL**：600 秒（10 分钟）

**命中逻辑**：
1. 查询 Redis，命中直接返回。
2. 未命中：查数据库 → 写入缓存 → 返回。

### 3. 历史列表缓存（GET /api/plans）

**目的**：减少列表查询的数据库压力。

**缓存键**：
```
plan:list:{page}:{pageSize}:{destinationHash}
```
其中 `destinationHash` 为 destination 字符串的 SHA-256 摘要前 8 位；无 destination 时为 `none`。

**缓存值**：列表查询结果（items + total + page + pageSize）。

**TTL**：60 秒（1 分钟）

**失效策略**：`POST /api/plan` 成功生成新规划后，主动清空所有 `plan:list:*` 键（用 `SCAN` + `DEL`，或依赖短 TTL 自然过期）。

> 本阶段采用短 TTL 自然过期为主，可选主动清理。若实现主动清理，使用 `redis.keys('plan:list:*')` 获取键名后批量删除（开发环境数据量小，无性能问题）。

## 目标目录结构

```
apps/api/
├── prisma/
│   └── schema.prisma          # 不变
├── prisma.config.ts           # 不变
├── src/
│   ├── index.ts               # Hono 入口（不变）
│   ├── routes/
│   │   ├── health.ts          # 不变
│   │   ├── plan.ts            # 不变（缓存逻辑在 service 层）
│   │   └── plans.ts           # 不变（缓存逻辑在 service 层）
│   ├── services/
│   │   ├── travelService.ts   # 修改：加入规划结果缓存
│   │   ├── dbService.ts       # 修改：详情与列表查询加缓存
│   │   └── cacheService.ts    # 新增：Redis 缓存封装
│   ├── lib/
│   │   ├── prisma.ts          # 不变
│   │   └── redis.ts           # 新增：Redis 客户端单例
│   └── types/
│       └── api.ts             # 不变
└── package.json
```

## Redis 客户端（src/lib/redis.ts）

ioredis 客户端单例，带连接失败降级。

```typescript
import Redis from 'ioredis';

const globalForRedis = globalThis as unknown as { redis?: Redis };

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

export const redis =
  globalForRedis.redis ??
  new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: false,
    lazyConnect: false,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.redis = redis;
}

// 连接错误仅记日志，不抛出（降级为无缓存）
redis.on('error', (err) => {
  console.error('[Redis] 连接错误：', err.message);
});
```

> 单例模式避免开发环境热重载时创建过多连接。
> `REDIS_URL` 由根目录 `.env` 加载，API 入口 `index.ts` 中 `dotenv` 已显式加载根 `.env`。

## 缓存服务（src/services/cacheService.ts）

封装 Redis 读写，统一处理序列化、反序列化、异常降级。

### 核心方法

```typescript
/** 从缓存获取值，解析失败或 Redis 异常时返回 null */
async function get<T>(key: string): Promise<T | null>

/** 写入缓存，带 TTL，写入失败仅记日志 */
async function set(key: string, value: unknown, ttlSeconds: number): Promise<void>

/** 删除指定键 */
async function del(key: string): Promise<void>

/** 删除匹配 pattern 的所有键（用于列表缓存失效） */
async function delByPattern(pattern: string): Promise<void>
```

### 实现要点

- 序列化：`JSON.stringify(value)`
- 反序列化：`JSON.parse(raw)`，解析失败返回 null
- 所有 Redis 操作包裹 try/catch，异常时返回 null 或仅记日志，**不抛出**
- `get` 方法签名用泛型，调用方指定期望类型

## 缓存键工具函数（src/services/cacheService.ts）

```typescript
/** 计算规划结果缓存键 */
function planResultKey(request: TravelRequest, mode: RunMode): string

/** 计算详情缓存键 */
function planDetailKey(id: string): string

/** 计算列表缓存键 */
function planListKey(page: number, pageSize: number, destination?: string): string
```

- `planResultKey`：将请求参数排序后拼接，计算 SHA-256（用 Node.js `crypto` 模块，不额外依赖），取前 16 位。
- `planDetailKey`：`plan:detail:${id}`
- `planListKey`：`plan:list:${page}:${pageSize}:${destinationHash}`

## 业务服务改造

### 1. travelService.ts（generatePlan）

改造流程：

```
1. 解析请求 → 计算 planResultKey
2. 查缓存 get<TravelState>(key)
   ├─ 命中：state = 缓存值（跳过 Agent 执行）
   └─ 未命中：执行 Agent → state = result → set(key, state, ttl)
3. 持久化 savePlan(state, mode) → 获得 id/createdAt
4. 主动清理列表缓存 delByPattern('plan:list:*')
5. 按 format 返回结果
```

**缓存命中时的行为**：
- 仍调用 `savePlan` 生成新的数据库记录和 id（保证历史列表完整）
- 不调用 `buildTravelGraph()`（节省 LLM 调用）
- `summary`、`flights`、`hotels`、`activities`、`budget` 均来自缓存

**缓存未命中时的行为**：与原逻辑一致，执行 Agent 后将 `TravelState` 写入缓存。

**Redis 不可用降级**：`get` 返回 null 时走未命中逻辑，`set`/`delByPattern` 失败仅记日志，不影响主流程。

### 2. dbService.ts（listPlans、getPlanById）

#### getPlanById

```
1. 计算 planDetailKey(id)
2. 查缓存 get<TravelPlan>(key)
   ├─ 命中：直接返回
   └─ 未命中：查数据库 → set(key, result, 600) → 返回
```

#### listPlans

```
1. 计算 planListKey(page, pageSize, destination)
2. 查缓存 get<ListPlansResult>(key)
   ├─ 命中：直接返回
   └─ 未命中：查数据库 → set(key, result, 60) → 返回
```

## API 响应格式（不变）

本阶段**不修改任何 API 的请求/响应格式**。缓存对调用方完全透明。

- `POST /api/plan`：响应结构不变，仍包含 `id`、`createdAt`。
- `GET /api/plans`：响应结构不变。
- `GET /api/plans/:id`：响应结构不变。

## 环境变量

`.env.example` 新增：

```
# Redis 缓存连接
REDIS_URL=redis://localhost:6379
```

| 变量 | 默认值 | 说明 |
|------|--------|------|
| REDIS_URL | redis://localhost:6379 | Redis 连接串 |
| DATABASE_URL | - | PostgreSQL 连接（沿用 Phase6） |
| PORT | 3000 | HTTP 端口（沿用 Phase5） |

## scripts（apps/api/package.json）

新增依赖 `ioredis: ^6.0.0`。脚本不变（无新脚本）。

根 `package.json` 脚本不变。

## ✅ 本阶段交付标准

1. `pnpm install` 成功，`ioredis` 安装至 `apps/api`。
2. Redis 服务启动后，`POST /api/plan`（mock 模式）首次请求执行 Agent 并写入缓存。
3. 相同参数再次请求 `POST /api/plan`，命中缓存，跳过 Agent 执行（可通过日志或响应时间验证），但仍生成新的数据库记录和 id。
4. `GET /api/plans/:id` 首次查库并缓存，二次请求命中缓存。
5. `GET /api/plans` 首次查库并缓存，二次请求命中缓存。
6. `POST /api/plan` 成功后，列表缓存被清理（或 60 秒后自然过期），新记录出现在列表中。
7. Redis 未启动时，所有接口仍正常工作（降级为无缓存），仅日志报错。
8. mock 模式缓存 TTL 1 小时，llm 模式缓存 TTL 30 分钟，详情 10 分钟，列表 1 分钟。
9. Agent 调度逻辑零改动，工作流拓扑不变。
10. 数据库 Schema 零改动。

## ❌ Phase7 禁止清单

1. ❌ 禁止新增/删减 Agent 角色，禁止修改 LangGraph 调度流程图。
2. ❌ 禁止修改 Agent 内部业务逻辑、提示词、mock 数据生成规则。
3. ❌ 禁止修改数据库 Schema、Prisma 模型。
4. ❌ 禁止修改现有 API 的请求/响应格式（缓存对调用方透明）。
5. ❌ 禁止引入除 `ioredis` 以外的运行时依赖。
6. ❌ 禁止开发前端页面（Phase8 范围）。
7. ❌ 禁止在 Redis 不可用时阻断主流程（必须降级）。
8. ❌ 禁止缓存包含 `id`/`createdAt` 的完整响应（只缓存规划内容 `TravelState`）。
9. ❌ 禁止引入缓存击穿/穿透防护逻辑（如分布式锁、布隆过滤器）—— 本阶段为开发演示，无需。

## 工作流强制规则

1. 增量开发：装依赖 + 写 redis 单例 → 写 cacheService → 改 travelService 加规划缓存 → 改 dbService 加详情/列表缓存 → 验证。
2. 优先保证 mock 模式下的缓存跑通，再验证 llm 模式。
3. Redis 不可用降级是强制要求，必须验证 Redis 未启动时所有接口仍正常。
4. 任何超出本 Spec 范围的改动（如提前做前端、加分布式锁），停止开发，等待确认。
