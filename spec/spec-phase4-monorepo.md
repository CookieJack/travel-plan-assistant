# spec-phase4-monorepo.md

## 阶段前提

1. Phase0~Phase3 完整可用：5 Agent 调度、mock/llm 双模式、text/markdown/json 输出、文件落盘全部跑通。
2. 本阶段**不改动多 Agent 架构**（1 主控 + 4 子 Agent 数量不变）、**不修改 LangGraph 工作流图结构**（START → 并行(f/h/a) → budgeting → supervisor → END）。
3. 本阶段**不实现**后端 HTTP 服务、数据库、缓存、前端 UI——这些属于 Phase5~Phase8，本阶段仅做工程结构拆分。

## 阶段目标

将当前单包 `src/` 结构重构为 **pnpm workspace monorepo** 多包结构，抽离可复用代码到独立包，为后续 Phase5（Hono 后端）、Phase6（Prisma+PostgreSQL）、Phase7（Redis）、Phase8（React+Vite+shadcn）提供工程底座。

**核心原则：只搬代码、不改逻辑，Phase3 全部能力必须 100% 保留可用。**

## 技术栈与依赖版本锁定

> 所有版本均通过 `npm view` 实时查询确认，非训练记忆版本。
> 本阶段仅实际安装/迁移已有依赖；Phase5~Phase8 的新依赖在对应阶段才安装，此处仅锁定版本供后续引用。

### 本阶段实际涉及的依赖（已有，版本不变）

| 包 | 版本 | 所在包 |
|---|---|---|
| typescript | ^7.0.2 | 根 devDependency |
| tsup | ^8.5.1 | 根 devDependency |
| dotenv | ^17.4.2 | packages/llm |
| @types/node | ^26.4.1 | 根 devDependency |
| ts-node | ^10.9.2 | 根 devDependency（保留，未使用不删除） |
| langchain | ^1.5.10 | packages/agents |
| @langchain/core | ^1.2.9 | packages/agents, packages/llm |
| @langchain/langgraph | ^1.4.14 | packages/agents |
| @langchain/openai | ^1.5.11 | packages/llm |

### 后续阶段锁定版本（本阶段不安装）

| 包 | 版本 | 阶段 |
|---|---|---|
| hono | ^4.13.7 | Phase5 |
| @hono/node-server | ^2.1.1 | Phase5 |
| prisma | ^7.10.0 | Phase6 |
| @prisma/client | ^7.10.0 | Phase6 |
| ioredis | ^6.0.0 | Phase7 |
| react | ^19.2.8 | Phase8 |
| react-dom | ^19.2.8 | Phase8 |
| @types/react | ^19.2.18 | Phase8 |
| @types/react-dom | ^19.2.7 | Phase8 |
| vite | ^8.2.2 | Phase8 |
| @vitejs/plugin-react | ^6.1.1 | Phase8 |
| tailwindcss | ^4.3.3 | Phase8 |
| @tailwindcss/vite | ^4.3.3 | Phase8 |

> Prisma 说明：npm `latest` 标签为 `8.0.0-rc.13`（RC 预发布），本 Spec 锁定最新稳定版 `7.10.0`。

## 目标目录结构

```
travel-plan-assistant/
├── apps/
│   ├── api/                    # Phase5 填充，本阶段仅空壳 + package.json
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── cli/                    # CLI 入口（从原 src/main.ts 迁入）
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       └── main.ts
│   └── web/                    # Phase8 填充，本阶段仅空壳 + package.json
│       ├── package.json
│       └── tsconfig.json
├── packages/
│   ├── shared/                 # 共享类型 + 校验守卫 + 格式化输出
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts        # 统一导出
│   │       ├── travel.ts       # 原 src/types/travel.ts
│   │       └── formatter.ts    # 原 src/output/formatter.ts
│   ├── llm/                    # 豆包 LLM 封装
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       └── llm.ts          # 原 src/llm.ts
│   ├── mock-data/              # 模拟数据生成
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       └── mockData.ts     # 原 src/data/mockData.ts
│   └── agents/                 # 5 Agent + LangGraph 工作流
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts        # 导出 buildTravelGraph
│           ├── graph/
│           │   └── buildGraph.ts
│           └── agents/
│               ├── supervisor.ts
│               ├── flightAgent.ts
│               ├── hotelAgent.ts
│               ├── activitiesAgent.ts
│               └── budgetingAgent.ts
├── spec/                       # 规格文档（不动）
├── .env.example                # 不动
├── .gitignore
├── .npmrc
├── .nvmrc
├── AGENTS.md
├── pnpm-workspace.yaml
├── tsconfig.base.json          # 新增：基础 TS 配置
└── package.json                # 根：workspace 管理 + 共享 devDeps
```

## 包职责与依赖关系

### packages/shared
- **职责**：`TravelRequest`、`TravelState` 等类型定义；`validateFlightOutput` 等校验守卫；`formatPlan`、`formatPlanMarkdown`、`formatPlanJson` 格式化函数。
- **依赖**：无外部依赖。
- **导出**：所有类型、校验函数、格式化函数。

### packages/llm
- **职责**：豆包 LLM 单例封装（`getLLM`、`getJSONLLM`、`callLLMJson`、`setMode` 等）。
- **依赖**：`@langchain/openai`、`@langchain/core`、`dotenv`、`@travel/shared`（仅类型，如 `Validator`）。
- **导出**：LLM 相关函数与类型。

### packages/mock-data
- **职责**：`mockFlights`、`mockHotels`、`mockActivities` 模拟数据生成。
- **依赖**：`@travel/shared`（类型）。
- **导出**：mock 数据生成函数。

### packages/agents
- **职责**：5 个 Agent 节点函数 + `buildTravelGraph()` 工作流构建。**去 CLI 化**，只导出纯函数供调用方使用。
- **依赖**：`@langchain/langgraph`、`@langchain/core`、`langchain`、`@travel/shared`、`@travel/llm`、`@travel/mock-data`。
- **导出**：`buildTravelGraph`、各 Agent 函数（可选）。

### apps/cli
- **职责**：原 `src/main.ts` 命令行入口，解析参数、调用 `buildTravelGraph()`、输出结果。
- **依赖**：`@travel/agents`、`@travel/llm`、`@travel/shared`。
- **说明**：本阶段保留 CLI 用于验证迁移未破坏 Phase3 能力；Phase5 后端可用后是否废弃由后续 Spec 决定。

### apps/api（空壳）
- **职责**：Phase5 的 Hono HTTP 服务。本阶段仅创建 `package.json` + `tsconfig.json`，不写业务代码。

### apps/web（空壳）
- **职责**：Phase8 的 React 前端。本阶段仅创建 `package.json` + `tsconfig.json`，不写业务代码。

## 依赖关系图

```
apps/cli ──→ @travel/agents ──→ @travel/llm ──→ @travel/shared
                │                     │
                ├──→ @travel/mock-data ┘
                └──→ @travel/shared
```

## 迁移步骤（增量、不破坏现有能力）

1. **创建目录骨架**：`apps/`、`packages/` 及各子包目录。
2. **新增根配置**：
   - `pnpm-workspace.yaml`：声明 `apps/*`、`packages/*`。
   - `tsconfig.base.json`：基础编译选项（从现有 `tsconfig.json` 提取）。
   - 各包 `tsconfig.json`：`extends` 根配置，设置 `rootDir`/`outDir`。
3. **移动代码文件**（保持内容不变，仅改 import 路径）：
   - `src/types/travel.ts` → `packages/shared/src/travel.ts`
   - `src/output/formatter.ts` → `packages/shared/src/formatter.ts`
   - `src/llm.ts` → `packages/llm/src/llm.ts`
   - `src/data/mockData.ts` → `packages/mock-data/src/mockData.ts`
   - `src/agents/*.ts` → `packages/agents/src/agents/*.ts`
   - `src/graph/buildGraph.ts` → `packages/agents/src/graph/buildGraph.ts`
   - `src/main.ts` → `apps/cli/src/main.ts`
4. **各包新增 `src/index.ts`**：统一导出。
5. **更新 import 路径**：
   - 包内相对路径保持 `./`、`../`。
   - 跨包引用改为 `@travel/shared`、`@travel/llm`、`@travel/mock-data`、`@travel/agents`。
6. **各包 `package.json`**：声明 `name`（`@travel/xxx`）、`dependencies`、`devDependencies`、`scripts`（`build`、`dev`）、`main`/`exports`/`types`。
7. **根 `package.json`**：
   - `private: true`
   - `workspaces: ["apps/*", "packages/*"]`
   - 共享 `devDependencies`：`typescript`、`tsup`、`@types/node`、`ts-node`。
   - 根脚本：`build`（递归构建）、`dev`（CLI 调试）、`clean`。
8. **删除原 `src/` 目录**（确认迁移完成且构建通过后）。
9. **更新 `.gitignore`**：忽略各包 `dist/`、`node_modules`（根已忽略）。

## 构建配置

- 各包使用 `tsup` 构建 ESM，输出到包内 `dist/`。
- 根 `pnpm build` 按依赖顺序构建：`shared` → `llm` / `mock-data` → `agents` → `cli`。
- 暂不引入 Turbo/Nx，使用 pnpm 原生 `--filter` 与依赖顺序保证构建。

## ✅ 本阶段交付标准

1. `pnpm install` 成功，无 workspace 依赖错误。
2. `pnpm build` 成功，所有包产出 `dist/`。
3. `pnpm dev`（或 `pnpm --filter @travel/cli dev`）能正常运行 CLI，输入旅行需求输出完整方案（mock 模式）。
4. `--mode llm`、`--format markdown/json`、`--output` 全部功能与 Phase3 行为一致。
5. 5 Agent 调度逻辑零改动，工作流拓扑不变。
6. `apps/api`、`apps/web` 空壳存在，`package.json` 合法（不构建）。

## ❌ Phase4 禁止清单

1. ❌ 禁止新增/删减 Agent 角色，禁止修改 LangGraph 调度流程图与节点拓扑。
2. ❌ 禁止实现任何 HTTP 服务、路由、控制器（Phase5 范围）。
3. ❌ 禁止引入数据库、ORM、缓存客户端（Phase6/7 范围）。
4. ❌ 禁止开发前端页面、引入 React/Vite/Tailwind/shadcn（Phase8 范围）。
5. ❌ 禁止修改 Agent 内部业务逻辑、提示词、mock 数据生成规则。
6. ❌ 禁止删除 Phase3 的 mock 兜底逻辑、校验重试逻辑、格式化函数。
7. ❌ 禁止升级现有依赖版本（本阶段所有已有依赖版本不变）。
8. ❌ 禁止在 `apps/api`、`apps/web` 中写入任何业务代码。

## 工作流强制规则

1. 增量迁移：先建骨架 → 再搬文件 → 再改 import → 再删原目录。每步验证。
2. 优先保证 `mock` 模式 CLI 跑通，再验证 `llm` 模式与多格式输出。
3. 任何想超出本 Spec 范围的改动（如提前接 Hono、提前建 Prisma schema），停止开发，等待确认。
4. 迁移后原 `src/` 目录必须删除，不保留冗余副本。
