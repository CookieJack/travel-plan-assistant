# spec-phase5-hono-api.md

## 阶段前提

1. Phase4 完成：pnpm monorepo 结构就绪，`packages/agents` 导出 `buildTravelGraph()`，CLI 可正常运行 mock/llm 双模式。
2. 本阶段**不改动多 Agent 架构**（1 主控 + 4 子 Agent）、**不修改 LangGraph 工作流图结构**。
3. 本阶段**不引入**数据库、ORM、缓存、前端 UI——这些属于 Phase6~Phase8。

## 阶段目标

用 **Hono** 把旅行规划 Agent 封装为 HTTP 服务，对外提供 REST API，使前端（Phase8）或其他调用方可通过 HTTP 触发旅行规划并获取结果。

**核心原则：只加 HTTP 外壳，不改 Agent 内部逻辑。**

## 技术栈与依赖版本锁定

> 所有版本均通过 `npm view` 实时查询确认。

### 本阶段新增依赖

| 包 | 版本 | 用途 |
|---|---|---|
| hono | ^4.13.7 | Web 框架 |
| @hono/node-server | ^2.1.1 | Node.js 运行时适配器 |

### 复用已有 workspace 包

| 包 | 用途 |
|---|---|
| @travel/agents | 提供 `buildTravelGraph()` |
| @travel/llm | 提供 `setMode()`、`isLLMMode()` |
| @travel/shared | 提供 `TravelRequest` 类型、`formatPlan*` 格式化函数、校验守卫 |

### 不新增的依赖

- ❌ 不引入数据库/ORM（Phase6）
- ❌ 不引入缓存客户端（Phase7）
- ❌ 不引入 zod/ajv 等校验库（复用 shared 手写守卫 + 简单字段校验）
- ❌ 不引入日志库（用 console）

## 目标目录结构

```
apps/api/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts          # Hono 应用入口：创建 app、注册路由、启动服务
    ├── routes/
    │   ├── health.ts     # GET /api/health
    │   └── plan.ts       # POST /api/plan
    ├── services/
    │   └── travelService.ts  # 封装 buildTravelGraph 调用，处理 mode/format
    └── types/
        └── api.ts        # API 请求/响应类型（可复用 shared 的 TravelRequest）
```

## API 设计

### GET /api/health

健康检查，供部署探活使用。

**响应**（200）：
```json
{ "status": "ok", "service": "travel-plan-api" }
```

### POST /api/plan

生成旅行规划方案。

**Query 参数**：

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| mode | string | 否 | mock | 运行模式：`mock` 或 `llm` |
| format | string | 否 | json | 输出格式：`text` / `markdown` / `json` |

**请求 Body**（JSON）：

```json
{
  "destination": "东京",
  "days": 5,
  "travelDate": "2026-10-01",
  "budget_limit": 8000,
  "user_preference": "美食",
  "travel_style": "舒适"
}
```

字段说明：
- `destination`（string，必填）：目的地
- `days`（number，必填，>0）：出行天数
- `travelDate`（string，必填）：出行时间 YYYY-MM-DD
- `budget_limit`（number，可选，>0）：预算上限
- `user_preference`（string，可选）：用户偏好
- `travel_style`（string，可选）：出行风格

**响应**（200）：

当 `format=json` 时，返回结构化数据：
```json
{
  "request": { ... },
  "flights": { ... },
  "hotels": { ... },
  "activities": { ... },
  "budget": { ... },
  "summary": "..."
}
```

当 `format=text` 或 `format=markdown` 时，返回：
```json
{
  "format": "text",
  "content": "完整的旅行方案文本..."
}
```

**错误响应**（400/500）：
```json
{
  "error": "错误描述",
  "code": "VALIDATION_ERROR" | "INTERNAL_ERROR"
}
```

## 实现要点

### 1. Hono 应用创建（src/index.ts）

- 使用 `new Hono()` 创建应用
- 注册 CORS 中间件（允许前端跨域调用）
- 注册路由：`/api/health`、`/api/plan`
- 使用 `@hono/node-server` 的 `serve()` 启动，监听 `process.env.PORT || 3000`
- 全局错误处理：捕获未处理异常，返回 500 JSON

### 2. 旅行规划服务（src/services/travelService.ts）

封装 Agent 调用，职责：
- 接收 `TravelRequest` + `mode` + `format`
- 调用 `setMode(mode)` 设置运行模式
- 调用 `buildTravelGraph().invoke({ request })`
- 根据 `format` 选择返回结构化结果或格式化文本
- 不修改 Agent 内部逻辑，仅做编排

### 3. 请求校验（routes/plan.ts）

- 校验 `destination` 为非空字符串
- 校验 `days` 为正整数
- 校验 `travelDate` 为非空字符串
- 可选字段若存在则校验类型（`budget_limit` 为正数，`user_preference`/`travel_style` 为字符串）
- 校验失败返回 400

### 4. CORS

使用 Hono 内置 `cors()` 中间件，允许所有来源（开发阶段），允许 `POST`、`GET`、`OPTIONS` 方法。

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| PORT | 3000 | HTTP 服务监听端口 |
| NODE_ENV | development | 运行环境 |
| DOUBAO_API_KEY | - | 豆包密钥（沿用根 .env） |
| DOUBAO_MODEL | - | 豆包模型（沿用根 .env） |

> `.env` 文件仍在项目根目录，`dotenv/config` 由 `@travel/llm` 加载，API 服务通过 `@travel/llm` 间接读取密钥。

## scripts（apps/api/package.json）

```json
{
  "scripts": {
    "build": "tsup src/index.ts --format esm --out-dir dist --external dotenv",
    "dev": "tsup src/index.ts --format esm --out-dir dist --external dotenv --watch",
    "start": "node dist/index.js"
  }
}
```

根 `package.json` 新增脚本：
- `dev:api`：`pnpm --filter @travel/api dev`
- `start:api`：`pnpm --filter @travel/api start`

## ✅ 本阶段交付标准

1. `pnpm --filter @travel/api build` 成功。
2. `pnpm dev:api` 启动后，`GET /api/health` 返回 `{"status":"ok"}`。
3. `POST /api/plan`（mock 模式）能正常返回旅行方案。
4. `POST /api/plan?mode=llm`（llm 模式）能调用真实豆包 LLM 生成方案。
5. `format=text/markdown/json` 三种格式均正常返回。
6. 请求参数校验生效：缺 `destination` 或 `days` 时返回 400。
7. Agent 调度逻辑零改动，工作流拓扑不变。

## ❌ Phase5 禁止清单

1. ❌ 禁止新增/删减 Agent 角色，禁止修改 LangGraph 调度流程图。
2. ❌ 禁止引入数据库、ORM、迁移脚本（Phase6 范围）。
3. ❌ 禁止引入缓存客户端（Phase7 范围）。
4. ❌ 禁止开发前端页面（Phase8 范围）。
5. ❌ 禁止修改 Agent 内部业务逻辑、提示词、mock 数据生成规则。
6. ❌ 禁止新增 zod/ajv 等第三方校验库。
7. ❌ 禁止新增除 hono、@hono/node-server 以外的运行时依赖。

## 工作流强制规则

1. 增量开发：先建 Hono 应用骨架 + health 路由 → 再加 plan 路由 + service → 再调试验证。
2. 优先保证 mock 模式 API 跑通，再验证 llm 模式。
3. 任何超出本 Spec 范围的改动（如提前接数据库、加用户体系），停止开发，等待确认。
