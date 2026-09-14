# spec-phase10-tool-calling.md

## 阶段前提

1. Phase0–Phase9 全部完成：多 Agent 架构稳定，Hono API + PostgreSQL + Redis + 前端 UI + Docker 部署均可用。
2. 本阶段**不改动多 Agent 架构**（1 主控 + 4 子 Agent 数量不变）、**不修改 LangGraph 工作流图结构**（START → 并行(f/h/a) → budgeting → supervisor → END）。仅在 `StateAnnotation` 中新增 `toolCalls` 字段定义（不改动节点和边）。
3. 本阶段**仅改造 flightAgent**，其余 Agent（hotel/activities/budgeting/supervisor）保持不变。
4. 本阶段**不新增任何 npm 依赖**：工具参数 Schema 使用 JSON Schema（`@langchain/core/tools` 的 `tool` 函数原生支持），不引入 zod。
5. 本阶段**不接入真实业务 API**：工具内部仍调用 `@travel/mock-data`，但"工具调用链路"（LLM 决策 → 调用工具 → 解析结果）真实可用。

## 阶段目标

为 flightAgent 接入**真实的 Tool Calling 链路**，让 Agent 从"直接生成结果"升级为"自主决策调用工具获取数据"。工具本身是 Mock 的，但完整调用链路真实，为后续接入真实 API 预留扩展点。

**核心原则：**
1. mock 与 llm 两种模式**统一走工具调用链路**——mock 模式由固定逻辑调用工具，llm 模式由 LLM 决策调用工具。
2. 工具调用过程**可观测**：每次工具调用（工具名、参数、结果摘要）记录到全局状态，供 Phase11 可视化使用。
3. 工具层**抽象可扩展**：Mock 工具与未来真实 API 共用同一套工具接口，切换零成本。

## 技术栈与依赖约束

### 复用已有依赖（不新增）

| 包 | 版本 | 用途 |
|---|---|---|
| @langchain/core | ^1.2.9 | 提供 `tool` 函数、`DynamicStructuredTool` 类型、JSON Schema 支持 |
| @langchain/openai | ^1.5.11 | `ChatOpenAI.bindTools()` 实现 Function Calling |
| @langchain/langgraph | ^1.4.14 | 工作流编排（拓扑不变） |
| @travel/shared | workspace:* | 类型定义（扩展 TravelState） |
| @travel/llm | workspace:* | LLM 实例与模式开关 |
| @travel/mock-data | workspace:* | 工具内部调用的 Mock 数据源 |

### 不新增的依赖

- ❌ 不引入 zod（用 JSON Schema 定义工具参数）
- ❌ 不引入新的校验库
- ❌ 不引入新的日志库（用 console）

## 目标目录结构

```
packages/agents/src/
├── agents/
│   ├── flightAgent.ts        # 修改：接入工具调用
│   ├── hotelAgent.ts         # 不变
│   ├── activitiesAgent.ts    # 不变
│   ├── budgetingAgent.ts     # 不变
│   └── supervisor.ts         # 不变
├── graph/
│   └── buildGraph.ts         # 不变（拓扑不动）
├── tools/                    # 新增：工具抽象层
│   ├── types.ts              # 工具接口定义
│   ├── flightTools.ts        # 机票工具实现
│   └── index.ts              # 工具统一导出
└── index.ts                  # 修改：导出工具层
```

## 核心设计

### 1. 工具抽象层（packages/agents/src/tools/）

#### 1.1 工具接口定义（types.ts）

```typescript
import type { DynamicStructuredTool } from '@langchain/core/tools';

/**
 * 工具调用记录（写入全局状态，供可视化使用）
 */
export interface ToolCallRecord {
  /** 调用工具的 Agent 名称 */
  agent: string;
  /** 工具名称 */
  toolName: string;
  /** 工具调用参数（JSON 序列化后的对象） */
  args: Record<string, unknown>;
  /** 工具返回结果摘要（截断后的字符串，避免状态过大） */
  resultSummary: string;
  /** 调用时间戳（ISO 字符串） */
  timestamp: string;
  /** 调用模式：mock（固定逻辑调用）/ llm（LLM 决策调用） */
  mode: 'mock' | 'llm';
}

/**
 * Agent 可用工具集合
 * 每个 Agent 拥有自己的工具列表，互不干扰
 */
export interface AgentTools {
  flight: DynamicStructuredTool[];
  // hotel / activities / budgeting 留空，Phase12 扩展
}
```

#### 1.2 机票工具（flightTools.ts）

定义 `searchFlights` 工具，参数用 JSON Schema 描述，内部调用 `mockFlights`：

```typescript
import { tool } from '@langchain/core/tools';
import { mockFlights } from '@travel/mock-data';
import type { TravelRequest } from '@travel/shared';

/**
 * searchFlights 工具：根据目的地、日期、预算查询机票方案
 * 内部调用 @travel/mock-data 的 mockFlights，未来可替换为真实 API
 */
export const searchFlightsTool = tool(
  async (input: { destination: string; travelDate: string; budgetLimit?: number }) => {
    // 构造 TravelRequest 调用 mockFlights
    const request: TravelRequest = {
      destination: input.destination,
      days: 1, // mockFlights 仅用 destination + budget 判断档位，days 不影响机票
      travelDate: input.travelDate,
      budget_limit: input.budgetLimit,
    };
    const options = mockFlights(request);
    // 返回 JSON 字符串，LLM 可解析
    return JSON.stringify({ options });
  },
  {
    name: 'searchFlights',
    description: '根据目的地、出行日期和预算查询可用机票方案，返回3个可选航班（含航司、航班号、时段、价格、舱位）。',
    schema: {
      type: 'object',
      properties: {
        destination: {
          type: 'string',
          description: '旅行目的地城市名称',
        },
        travelDate: {
          type: 'string',
          description: '出行日期，格式 YYYY-MM-DD',
        },
        budgetLimit: {
          type: 'number',
          description: '机票预算上限（元），可选',
        },
      },
      required: ['destination', 'travelDate'],
    } as const,
  },
);
```

> 说明：`tool` 函数的 `schema` 字段接受 JSON Schema 7 类型，无需 zod。工具返回字符串（JSON 序列化），LLM 可直接解析。

#### 1.3 工具统一导出（index.ts）

```typescript
export { searchFlightsTool } from './flightTools.js';
export type { ToolCallRecord, AgentTools } from './types.js';
```

### 2. 状态扩展（packages/shared/src/travel.ts）

在 `TravelState` 中新增 `toolCalls` 字段：

```typescript
export interface TravelState {
  request: TravelRequest;
  flights?: FlightResult;
  hotels?: HotelResult;
  activities?: ActivitiesResult;
  budget?: BudgetResult;
  summary?: string;
  /** 工具调用记录（Phase10 新增，供可视化使用） */
  toolCalls?: ToolCallRecord[];
}
```

`ToolCallRecord` 类型定义移至 `@travel/shared`（因为 TravelState 在 shared 中），agents 包从 shared 导入。

### 3. flightAgent 改造（packages/agents/src/agents/flightAgent.ts）

#### 改造原则

- **mock 模式**：由固定逻辑直接调用 `searchFlightsTool`，传入 request 参数，拿到结果后构造 `FlightResult`，同时记录 `ToolCallRecord`。
- **llm 模式**：使用 `ChatOpenAI.bindTools([searchFlightsTool])`，让 LLM 自主决策是否调用工具、传什么参数；解析 LLM 返回的 `tool_calls`，执行工具，将结果回传 LLM，再生成最终结构化输出。
- **两种模式统一记录 toolCalls 到 state**。

#### mock 模式流程

```
1. 从 state.request 提取 destination, travelDate, budget_limit
2. 直接调用 searchFlightsTool.invoke({ destination, travelDate, budgetLimit })
3. 解析返回的 JSON 字符串 → FlightOption[]
4. 构造 FlightResult
5. 记录 ToolCallRecord { agent: 'FlightSearchAgent', toolName: 'searchFlights', args, resultSummary, timestamp, mode: 'mock' }
6. 返回 { flights, toolCalls: [record] }
```

#### llm 模式流程

```
1. 获取 LLM 实例，bindTools([searchFlightsTool])
2. 构造 system prompt（告知 Agent 可用工具、输出 JSON 格式要求）
3. 第一次调用 LLM（带 request 信息）
4. 检查 response.tool_calls：
   - 有 tool_calls：执行对应工具 → 构造 ToolMessage → 第二次调用 LLM
   - 无 tool_calls：直接解析 response.content 为 JSON
5. 校验最终输出（沿用 validateFlightOutput）
6. 记录 ToolCallRecord（mode: 'llm'）
7. 构造 FlightResult，返回 { flights, toolCalls: [record] }
8. 失败兜底：重试或回退 mock 模式（沿用现有 callLLMJson 的重试逻辑风格）
```

#### 关键约束

- **最多 1 轮工具调用**：flightAgent 只调用一次 searchFlights，不做多轮循环（避免复杂度，Phase10 只做示范）。
- **输出格式不变**：`flights` 字段结构与改造前完全一致，不影响后续 budgeting/supervisor。
- **toolCalls 只追加**：flightAgent 返回 `toolCalls: [record]`，LangGraph 会合并到全局 state（需确认合并策略，见下文）。

### 4. LangGraph 状态合并策略

LangGraph 的 `Annotation` 默认合并策略是**覆盖**（非 reducer）。flightAgent 返回 `{ flights, toolCalls: [record] }` 会**覆盖**全局 state 的 `toolCalls` 字段。

由于本阶段只有 flightAgent 写 toolCalls，覆盖策略无影响。但为了后续 Phase12（hotelAgent 也写 toolCalls），需要在 Spec 中明确：

- **本阶段**：在 `StateAnnotation` 中新增 `toolCalls: Annotation<ToolCallRecord[] | undefined>()`，使用默认覆盖策略（因为只有 flightAgent 写入）。
- **Phase12 扩展时**：需将 `toolCalls` 的 Annotation 改为 reducer 合并（`Annotation<ToolCallRecord[]>({ reducer: (left, right) => [...(left ?? []), ...(right ?? [])] })`）。

## API 响应格式（不变）

本阶段**不修改任何 API 的请求/响应格式**。

- `POST /api/plan`：响应结构不变，新增的 `toolCalls` 字段会随 `TravelState` 一起返回（因为 Phase6 的 `savePlan` 序列化整个 state）。
- `GET /api/plans/:id`：详情中包含 `toolCalls`（如果规划时产生了工具调用）。
- `GET /api/plans`：列表接口不变（不返回 toolCalls）。

> `toolCalls` 字段对前端透明，Phase11 才会在 UI 中展示。

## 缓存兼容性（Phase7）

Phase7 的规划结果缓存存储的是整个 `TravelState`，包含 `toolCalls`。这意味着：
- 缓存命中时，`toolCalls` 也来自缓存（与规划结果一致）。
- 缓存未命中时，新执行的 Agent 会产生新的 `toolCalls`。

这是符合预期的，无需额外处理。

## ✅ 本阶段交付标准

1. `pnpm build` 成功，无 TypeScript 错误。
2. mock 模式下，`POST /api/plan` 返回的结果中包含 `toolCalls` 字段，且有一条 `mode: 'mock'` 的 `searchFlights` 调用记录。
3. llm 模式下，`POST /api/plan` 返回的结果中包含 `toolCalls` 字段，且有一条 `mode: 'llm'` 的 `searchFlights` 调用记录（LLM 自主决策调用）。
4. mock 和 llm 两种模式下，`flights` 字段结构与改造前完全一致（不影响 budgeting/supervisor）。
5. 工具调用链路真实可用：llm 模式下，LLM 确实通过 `bindTools` 发起了 `searchFlights` 调用（可通过日志或 toolCalls 记录验证）。
6. 其余 Agent（hotel/activities/budgeting/supervisor）行为不变，输出不变。
7. LangGraph 工作流拓扑不变，节点名称不变。
8. 无新增 npm 依赖。
9. 缓存、持久化、前端展示均不受影响（toolCalls 字段随 state 流转，前端暂不展示）。

## ❌ Phase10 禁止清单

1. ❌ 禁止新增/删减 Agent 角色，禁止修改 LangGraph 调度流程图与节点拓扑。
2. ❌ 禁止改造除 flightAgent 以外的任何 Agent。
3. ❌ 禁止接入真实机票/酒店/旅游第三方业务 API。
4. ❌ 禁止新增 npm 依赖（工具参数用 JSON Schema，不用 zod）。
5. ❌ 禁止修改 `flights` 字段的输出结构（必须保持向后兼容）。
6. ❌ 禁止修改 buildGraph.ts 的工作流拓扑（节点和边），仅允许新增 `toolCalls` 字段到 `StateAnnotation`。
7. ❌ 禁止在前端展示 toolCalls（Phase11 范围）。
8. ❌ 禁止新增 SSE 端点（Phase11 范围）。
9. ❌ 禁止删除或重写现有 mock 逻辑（mockFlights 保持不变）。
10. ❌ 禁止修改现有 API 的请求/响应格式（toolCalls 是新增字段，不改变已有字段）。

## 工作流强制规则

1. 增量开发：先写工具抽象层（types + flightTools）→ 扩展 shared 类型 → 改造 flightAgent → 验证。
2. 优先保证 mock 模式下的工具调用链路跑通，再调试 llm 模式的 Function Calling。
3. llm 模式必须验证 LLM 确实发起了 tool_call（通过 toolCalls 记录或日志），不能是"假装调用"。
4. 任何超出本 Spec 范围的改动（如给其他 Agent 加工具、加 SSE、改前端），停止开发，等待确认。
