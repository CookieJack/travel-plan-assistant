# spec-phase12-multi-agent-tools.md

## 阶段前提

1. Phase0–Phase11 全部完成：多 Agent 架构稳定，flightAgent 已接入工具调用链路，SSE 流式规划与执行过程可视化可用，toolCalls 已持久化到 DB。
2. 本阶段**不改动多 Agent 架构**（1 主控 + 4 子 Agent 数量不变）、**不修改 LangGraph 工作流图结构**（START → 并行(f/h/a) → budgeting → supervisor → END）。仅修改 `StateAnnotation` 中 `toolCalls` 字段的合并策略（从默认覆盖改为 reducer 合并）。
3. 本阶段**仅改造 hotelAgent 与 activitiesAgent**，复用 flightAgent 的工具调用模式（mock 固定调用 / llm 自主决策）。budgetingAgent 与 supervisorAgent 保持不变（两者为汇总计算类 Agent，不涉及外部数据查询，无需工具调用）。
4. 本阶段**不新增任何 npm 依赖**：工具参数 Schema 继续使用 JSON Schema（`@langchain/core/tools` 的 `tool` 函数原生支持）。
5. 本阶段**不接入真实业务 API**：工具内部仍调用 `@travel/mock-data`，仅扩展工具调用链路覆盖范围。

## 阶段目标

将 Phase10 为 flightAgent 建立的**工具调用链路扩展到 hotelAgent 与 activitiesAgent**，使三个数据查询类 Agent（flight / hotel / activities）统一走"LLM 决策 → 调用工具 → 解析结果"的链路，工具调用过程全程可观测。

**核心原则：**
1. 三个查询类 Agent（flight / hotel / activities）的工具调用模式统一：mock 模式固定逻辑调用工具，llm 模式 LLM 自主决策调用工具。
2. **toolCalls 状态合并策略从覆盖改为 reducer 追加**，确保三个并行 Agent 的工具调用记录不互相覆盖。
3. 工具调用过程可观测：每个 Agent 的工具调用记录（工具名、参数、结果摘要、模式）追加到全局 `state.toolCalls`，供 Phase11 的执行过程可视化展示。
4. 工具层抽象可扩展：Mock 工具与未来真实 API 共用同一套工具接口，切换零成本。

## 技术栈与依赖约束

### 复用已有依赖（不新增）

| 包 | 版本 | 用途 |
|---|---|---|
| @langchain/core | ^1.2.9 | `tool` 函数、`DynamicStructuredTool` 类型、JSON Schema 支持、ToolMessage |
| @langchain/openai | ^1.5.11 | `ChatOpenAI.bindTools()` 实现 Function Calling |
| @langchain/langgraph | ^1.4.14 | Annotation reducer 合并策略 |
| @travel/shared | workspace:* | 类型定义（TravelState / ToolCallRecord / HotelOption / DayItinerary） |
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
│   ├── flightAgent.ts        # 不变（Phase10 已完成）
│   ├── hotelAgent.ts         # 修改：接入工具调用
│   ├── activitiesAgent.ts    # 修改：接入工具调用
│   ├── budgetingAgent.ts     # 不变
│   └── supervisor.ts         # 不变
├── graph/
│   └── buildGraph.ts         # 修改：toolCalls Annotation 改为 reducer 合并
├── tools/
│   ├── types.ts              # 修改：AgentTools 新增 hotel / activities
│   ├── flightTools.ts        # 不变
│   ├── hotelTools.ts         # 新增：searchHotels 工具
│   ├── activitiesTools.ts    # 新增：searchActivities 工具
│   ├── utils.ts              # 新增：共享工具调用辅助函数（buildToolCallRecord / summarizeResult / cleanUndefined）
│   └── index.ts              # 修改：导出新增工具
└── index.ts                  # 修改：导出新增工具
```

## 核心设计

### 1. 共享工具调用辅助函数（packages/agents/src/tools/utils.ts）

#### 1.1 抽取背景

flightAgent（Phase10）中已实现 `buildToolCallRecord`、`summarizeResult`、`cleanUndefined` 三个辅助函数。hotelAgent 与 activitiesAgent 需要完全相同的逻辑，因此抽取到 `tools/utils.ts` 共享，避免重复代码。

#### 1.2 utils.ts 内容

```typescript
import type { ToolCallRecord } from '@travel/shared';

/**
 * 清理对象中的 undefined 值（Prisma JSON 序列化不支持 undefined）
 */
export function cleanUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

/**
 * 构造工具调用记录
 */
export function buildToolCallRecord(
  agent: string,
  toolName: string,
  args: Record<string, unknown>,
  resultSummary: string,
  mode: 'mock' | 'llm',
): ToolCallRecord {
  return {
    agent,
    toolName,
    args: cleanUndefined(args),
    resultSummary,
    timestamp: new Date().toISOString(),
    mode,
  };
}

/**
 * 截断结果摘要，避免 state 过大
 */
export function summarizeResult(result: string, maxLen = 200): string {
  if (result.length <= maxLen) return result;
  return result.slice(0, maxLen) + '...';
}
```

> 说明：flightAgent 中原有的同名函数应替换为从 `tools/utils.js` 导入（保持行为完全一致，仅去重）。

### 2. 新增酒店工具（packages/agents/src/tools/hotelTools.ts）

#### 2.1 searchHotels 工具

```typescript
import { tool } from '@langchain/core/tools';
import { mockHotels } from '@travel/mock-data';
import type { TravelRequest } from '@travel/shared';

/** searchHotels 工具的输入参数 */
interface SearchHotelsInput {
  destination: string;
  days: number;
  budgetLimit?: number;
  travelStyle?: string;
}

/**
 * searchHotels 工具
 *
 * 根据目的地、出行天数、预算和出行风格查询可用酒店方案。
 * 内部调用 @travel/mock-data 的 mockHotels，返回 3 个可选酒店。
 *
 * 未来接入真实酒店 API 时，只需替换此函数内部实现，
 * Agent 侧的工具调用逻辑无需改动。
 */
export const searchHotelsTool = tool(
  async (input: SearchHotelsInput): Promise<string> => {
    const request: TravelRequest = {
      destination: input.destination,
      days: input.days,
      travelDate: '', // mockHotels 不使用 travelDate，传空字符串占位
      budget_limit: input.budgetLimit,
      travel_style: input.travelStyle,
    };

    const options = mockHotels(request);

    // 返回 JSON 字符串，LLM 可直接解析
    return JSON.stringify({ options });
  },
  {
    name: 'searchHotels',
    description:
      '根据目的地、出行天数、预算和出行风格查询可用酒店方案，返回3个可选酒店（含名称、星级、房型、每晚价格、位置）。',
    schema: {
      type: 'object',
      properties: {
        destination: {
          type: 'string',
          description: '旅行目的地城市名称',
        },
        days: {
          type: 'number',
          description: '出行天数（用于计算住宿晚数）',
        },
        budgetLimit: {
          type: 'number',
          description: '酒店预算上限（元），可选',
        },
        travelStyle: {
          type: 'string',
          description: '出行风格（穷游/舒适/轻奢），可选',
        },
      },
      required: ['destination', 'days'],
    } as const,
  },
);
```

> 说明：`mockHotels` 实际只使用 `destination` + `budget_limit` + `travel_style` 判断价格档位（见 mockData.ts 的 `isLowBudget` / `isHighBudget`），`days` 与 `travelDate` 不影响酒店结果。但工具参数保留 `days` 以提供语义完整性，`travelDate` 传空字符串占位（mockHotels 不使用）。

### 3. 新增游玩活动工具（packages/agents/src/tools/activitiesTools.ts）

#### 3.1 searchActivities 工具

```typescript
import { tool } from '@langchain/core/tools';
import { mockActivities } from '@travel/mock-data';
import type { TravelRequest } from '@travel/shared';

/** searchActivities 工具的输入参数 */
interface SearchActivitiesInput {
  destination: string;
  days: number;
  userPreference?: string;
}

/**
 * searchActivities 工具
 *
 * 根据目的地、出行天数和用户偏好生成每日游玩行程。
 * 内部调用 @travel/mock-data 的 mockActivities，返回每日活动列表。
 *
 * 未来接入真实景点/活动 API 时，只需替换此函数内部实现，
 * Agent 侧的工具调用逻辑无需改动。
 */
export const searchActivitiesTool = tool(
  async (input: SearchActivitiesInput): Promise<string> => {
    const request: TravelRequest = {
      destination: input.destination,
      days: input.days,
      travelDate: '', // mockActivities 不使用 travelDate
      user_preference: input.userPreference,
    };

    const itinerary = mockActivities(request);

    // 返回 JSON 字符串，LLM 可直接解析
    return JSON.stringify({ itinerary });
  },
  {
    name: 'searchActivities',
    description:
      '根据目的地、出行天数和用户偏好生成每日游玩行程，返回每日活动列表（含时间、活动名称、描述、费用）。',
    schema: {
      type: 'object',
      properties: {
        destination: {
          type: 'string',
          description: '旅行目的地城市名称',
        },
        days: {
          type: 'number',
          description: '出行天数',
        },
        userPreference: {
          type: 'string',
          description: '用户偏好（美食/自然风光/博物馆/亲子等），可选',
        },
      },
      required: ['destination', 'days'],
    } as const,
  },
);
```

### 4. AgentTools 类型扩展（packages/agents/src/tools/types.ts）

```typescript
import type { DynamicStructuredTool } from '@langchain/core/tools';

/**
 * Agent 可用工具集合
 * 每个 Agent 拥有自己的工具列表，互不干扰
 * budgeting / supervisor 为汇总计算类 Agent，无独立数据查询工具
 */
export interface AgentTools {
  flight: DynamicStructuredTool[];
  hotel: DynamicStructuredTool[];     // Phase12 新增
  activities: DynamicStructuredTool[]; // Phase12 新增
}
```

### 5. 工具统一导出（packages/agents/src/tools/index.ts）

```typescript
export { searchFlightsTool } from './flightTools.js';
export { searchHotelsTool } from './hotelTools.js';         // Phase12 新增
export { searchActivitiesTool } from './activitiesTools.js'; // Phase12 新增
export {
  buildToolCallRecord,
  summarizeResult,
  cleanUndefined,
} from './utils.js'; // Phase12 新增
export type { AgentTools } from './types.js';
```

### 6. LangGraph toolCalls 合并策略变更（packages/agents/src/graph/buildGraph.ts）

#### 6.1 变更原因

Phase10 中 `toolCalls` 使用默认覆盖策略，因为当时只有 flightAgent 写入。Phase12 起，flight / hotel / activities 三个 Agent **并行执行**且**都会写入 toolCalls**。若仍用覆盖策略，后完成的 Agent 会覆盖先完成 Agent 的记录，导致工具调用记录丢失。

#### 6.2 变更内容

```typescript
// Phase10（覆盖策略，仅 flightAgent 写入时可用）
toolCalls: Annotation<ToolCallRecord[] | undefined>(),

// Phase12（reducer 追加策略，多 Agent 并行写入）
toolCalls: Annotation<ToolCallRecord[] | undefined>({
  reducer: (left, right) => [...(left ?? []), ...(right ?? [])],
}),
```

> 说明：
> - `left` 为已有 toolCalls，`right` 为当前节点返回的 toolCalls。
> - 并行节点的 reducer 合并由 LangGraph 内部按完成顺序处理，最终结果为三个 Agent toolCalls 的并集。
> - 每个 Agent 只返回自己的 `toolCalls: [record]`（单条记录），reducer 负责合并。
> - 此变更**不影响 flights/hotels/activities 等业务字段**（它们仍用默认覆盖策略，因每个字段只有一个 Agent 写入）。

### 7. hotelAgent 改造（packages/agents/src/agents/hotelAgent.ts）

#### 7.1 改造原则

完全复用 flightAgent（Phase10）的工具调用模式：
- **mock 模式**：固定逻辑直接调用 `searchHotelsTool`，传入 request 参数，拿到结果后构造 `HotelResult`，同时记录 `ToolCallRecord`。
- **llm 模式**：使用 `ChatOpenAI.bindTools([searchHotelsTool])`，让 LLM 自主决策是否调用工具、传什么参数；解析 LLM 返回的 `tool_calls`，执行工具，将结果回传 LLM，再生成最终结构化输出。
- **两种模式统一记录 toolCalls 到 state**。

#### 7.2 mock 模式流程

```
1. 从 state.request 提取 destination, days, budget_limit, travel_style
2. 直接调用 searchHotelsTool.invoke({ destination, days, budgetLimit, travelStyle })
3. 解析返回的 JSON 字符串 → HotelOption[]
4. 构造 HotelResult
5. 记录 ToolCallRecord { agent: 'HotelBookingAgent', toolName: 'searchHotels', args, resultSummary, timestamp, mode: 'mock' }
6. 返回 { hotels, toolCalls: [record] }
```

#### 7.3 llm 模式流程

```
1. 获取 LLM 实例，bindTools([searchHotelsTool])
2. 构造 system prompt（告知 Agent 可用工具、输出 JSON 格式要求）
3. 第一次调用 LLM（带 request 信息）
4. 检查 response.tool_calls：
   - 有 tool_calls：执行对应工具 → 构造 ToolMessage → 第二次调用 LLM
   - 无 tool_calls：直接解析 response.content 为 JSON
5. 校验最终输出（沿用 validateHotelOutput）
6. 记录 ToolCallRecord（mode: 'llm'）
7. 构造 HotelResult，返回 { hotels, toolCalls: [record] }
8. 失败兜底：重试或回退 mock 模式（沿用现有 callLLMJson 的重试逻辑风格）
```

#### 7.4 系统提示词

```
你是酒店预订智能体 HotelBookingAgent。
你可以使用 searchHotels 工具根据用户需求查询酒店方案。

工作流程：
1. 调用 searchHotels 工具，传入目的地、出行天数、预算和出行风格
2. 基于工具返回的酒店数据，输出严格 JSON 格式的结果

输出格式必须为：
{
  "options": [
    {
      "name": "酒店名称",
      "star": 星级数字（2-5）,
      "roomType": "房型",
      "pricePerNight": 数字（单位：元/晚）,
      "location": "位置描述（含目的地）"
    }
  ]
}

要求：
- 必须调用 searchHotels 工具获取数据，不要凭空编造
- 根据用户预算上限、出行风格匹配酒店档次（穷游→经济型/青旅，轻奢→五星/奢华）
- 3 个方案档次与价格需有差异
- 只输出 JSON，不要任何解释、注释或 Markdown 代码块
```

#### 7.5 关键约束

- **最多 1 轮工具调用**：hotelAgent 只调用一次 searchHotels，不做多轮循环（与 flightAgent 保持一致）。
- **输出格式不变**：`hotels` 字段结构与改造前完全一致，不影响后续 budgeting/supervisor。
- **toolCalls 只追加**：hotelAgent 返回 `toolCalls: [record]`，由 buildGraph 的 reducer 合并到全局 state。

### 8. activitiesAgent 改造（packages/agents/src/agents/activitiesAgent.ts）

#### 8.1 改造原则

与 hotelAgent 完全一致，复用 flightAgent 的工具调用模式。

#### 8.2 mock 模式流程

```
1. 从 state.request 提取 destination, days, user_preference
2. 直接调用 searchActivitiesTool.invoke({ destination, days, userPreference })
3. 解析返回的 JSON 字符串 → DayItinerary[]
4. 构造 ActivitiesResult
5. 记录 ToolCallRecord { agent: 'ActivitiesAgent', toolName: 'searchActivities', args, resultSummary, timestamp, mode: 'mock' }
6. 返回 { activities, toolCalls: [record] }
```

#### 8.3 llm 模式流程

```
1. 获取 LLM 实例，bindTools([searchActivitiesTool])
2. 构造 system prompt
3. 第一次调用 LLM
4. 检查 response.tool_calls：
   - 有 tool_calls：执行工具 → ToolMessage → 第二次调用 LLM
   - 无 tool_calls：直接解析 response.content
5. 校验最终输出（沿用 validateActivitiesOutput）
6. 记录 ToolCallRecord（mode: 'llm'）
7. 构造 ActivitiesResult，返回 { activities, toolCalls: [record] }
8. 失败兜底：回退 mock 模式
```

#### 8.4 系统提示词

```
你是游玩活动智能体 ActivitiesAgent。
你可以使用 searchActivities 工具根据用户需求生成每日游玩行程。

工作流程：
1. 调用 searchActivities 工具，传入目的地、出行天数和用户偏好
2. 基于工具返回的行程数据，输出严格 JSON 格式的结果

输出格式必须为：
{
  "itinerary": [
    {
      "day": 天数数字,
      "activities": [
        {
          "time": "HH:MM",
          "name": "活动名称",
          "description": "活动描述",
          "cost": 数字（单位：元）
        }
      ]
    }
  ]
}

要求：
- 必须调用 searchActivities 工具获取数据，不要凭空编造
- 行程天数必须等于用户提供的 days
- 根据用户偏好（美食/自然风光/博物馆/亲子等）优先安排匹配的活动
- 每天安排 3-4 个活动，时间合理不重叠
- 只输出 JSON，不要任何解释、注释或 Markdown 代码块
```

#### 8.5 关键约束

- **最多 1 轮工具调用**：与 flightAgent / hotelAgent 保持一致。
- **输出格式不变**：`activities` 字段结构与改造前完全一致。
- **toolCalls 只追加**：返回 `toolCalls: [record]`，由 reducer 合并。

### 9. flightAgent 去重（packages/agents/src/agents/flightAgent.ts）

将 flightAgent 中原有的 `buildToolCallRecord`、`summarizeResult`、`cleanUndefined` 三个函数删除，改为从 `tools/utils.js` 导入。**函数行为完全不变**，仅消除重复代码。

## API 响应格式（不变）

本阶段**不修改任何 API 的请求/响应格式**。

- `POST /api/plan`：响应结构不变，`toolCalls` 字段会随 `TravelState` 一起返回，且现在包含 flight / hotel / activities 三个 Agent 的工具调用记录。
- `POST /api/plan/stream`：SSE 事件格式不变，`node_complete` 事件的 `toolCalls` 字段现在对 `hotel_agent` / `activities_agent` 节点也有值。
- `GET /api/plans/:id`：详情中包含完整 `toolCalls`（三个 Agent 的记录）。
- `GET /api/plans`：列表接口不变（不返回 toolCalls）。

## 缓存兼容性（Phase7）

1. **规划结果缓存**：`plan:result:*` 存储完整 `TravelState`（含合并后的 `toolCalls`），无需改动。
2. **详情缓存**：`plan:detail:*` 存储 DB 记录（含 `toolCalls`），无需改动。
3. **列表缓存**：新规划完成后清理 `plan:list:*`，逻辑不变。
4. **注意**：Phase12 之前生成的历史记录在 DB 中 `toolCalls` 可能只含 flightAgent 的记录（或为 null），属预期行为。

## 可视化兼容性（Phase11）

1. **ExecutionProgress**：组件无需改动。`node_complete` 事件现在对 `hotel_agent` / `activities_agent` 也携带 `toolCalls`，组件会自动展示。
2. **ToolCallList**：组件无需改动。`toolCalls` 数组现在包含三个 Agent 的记录，按 `timestamp` 排序展示。
3. **PlanResult 执行过程 Tab**：无需改动，自动展示完整 toolCalls 列表。
4. **节点名称映射**：Phase11 的 `ExecutionProgress` 已有 `hotel_agent` → 「酒店 Agent」、`activities_agent` → 「游玩活动 Agent」的映射，无需改动。

## ✅ 本阶段交付标准

1. `pnpm build` 成功，无 TypeScript 错误。
2. mock 模式下，`POST /api/plan` 返回的 `toolCalls` 包含 3 条记录：
   - `FlightSearchAgent` 的 `searchFlights`（mode: 'mock'）
   - `HotelBookingAgent` 的 `searchHotels`（mode: 'mock'）
   - `ActivitiesAgent` 的 `searchActivities`（mode: 'mock'）
3. llm 模式下，`POST /api/plan` 返回的 `toolCalls` 包含 3 条记录，mode 均为 'llm'，且 LLM 确实发起了对应工具调用。
4. 三个 Agent 的输出字段（flights / hotels / activities）结构与改造前完全一致，不影响 budgeting/supervisor。
5. `toolCalls` 的 reducer 合并策略生效：三个并行 Agent 的工具调用记录全部保留，无覆盖丢失。
6. SSE 流式端点 `POST /api/plan/stream` 的 `node_complete` 事件对 hotel_agent / activities_agent 节点携带 toolCalls。
7. 前端执行过程可视化正确展示三个 Agent 的工具调用记录。
8. flightAgent 中的辅助函数已抽取到 `tools/utils.ts`，flightAgent 改为导入，行为不变。
9. budgetingAgent 与 supervisorAgent 行为不变，不产生 toolCalls。
10. LangGraph 工作流拓扑不变，仅 toolCalls Annotation 的合并策略变更。
11. 无新增 npm 依赖。

## ❌ Phase12 禁止清单

1. ❌ 禁止新增/删减 Agent 角色，禁止修改 LangGraph 调度流程图与节点拓扑。
2. ❌ 禁止改造 budgetingAgent 与 supervisorAgent（两者为汇总计算类，不涉及工具调用）。
3. ❌ 禁止修改 flights / hotels / activities / budget / summary 字段的输出结构。
4. ❌ 禁止修改 buildGraph.ts 的工作流拓扑（节点和边），仅允许修改 `toolCalls` Annotation 的合并策略。
5. ❌ 禁止接入真实机票/酒店/旅游第三方业务 API。
6. ❌ 禁止新增 npm 依赖。
7. ❌ 禁止实现多轮工具调用（每个 Agent 最多 1 轮，与 flightAgent 保持一致）。
8. ❌ 禁止修改 SSE 事件格式与现有 API 的请求/响应格式。
9. ❌ 禁止修改缓存键规则与 TTL。
10. ❌ 禁止改动 docker-compose.yml、Dockerfile.api、Dockerfile.web、nginx.conf。
11. ❌ 禁止删除或重写现有 mock 逻辑（mockHotels / mockActivities 保持不变）。
12. ❌ 禁止修改 flightAgent 的业务逻辑（仅允许辅助函数去重，工具调用行为不变）。

## 工作流强制规则

1. 增量开发顺序：
   1. 抽取 `tools/utils.ts` 共享辅助函数 → flightAgent 改为导入
   2. 新增 `hotelTools.ts` + `activitiesTools.ts`
   3. 更新 `tools/types.ts` + `tools/index.ts`
   4. 修改 `buildGraph.ts` 的 toolCalls reducer 合并策略
   5. 改造 hotelAgent（复用 flightAgent 模式）
   6. 改造 activitiesAgent（复用 flightAgent 模式）
   7. 验证
2. 优先验证 mock 模式下三个 Agent 的工具调用链路跑通，且 toolCalls 合并正确（3 条记录）。
3. 再验证 llm 模式的 Function Calling，确认 LLM 确实发起了 searchHotels / searchActivities 调用。
4. 必须验证 reducer 合并策略：三个并行 Agent 的 toolCalls 不互相覆盖。
5. 必须验证 SSE 流式端点：hotel_agent / activities_agent 的 node_complete 事件携带 toolCalls。
6. 必须验证 budgeting / supervisor 不产生 toolCalls，且其输出不受影响。
7. 任何超出本 Spec 范围的改动（如给 budgeting/supervisor 加工具、改前端、加新接口），停止开发，等待确认。
