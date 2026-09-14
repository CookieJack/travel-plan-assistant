# spec-phase15-multi-city-itinerary.md

## 阶段前提

1. Phase0–Phase14 全部完成：多 Agent 架构稳定，工具调用链路覆盖 flight/hotel/activities，SSE 流式规划与执行可视化可用，toolCalls 已持久化，zod 统一校验层已落地，用户反馈与规划迭代可用。
2. 当前规划为**单目的地**：`TravelRequest.destination` 为单个城市，LangGraph 拓扑为 `START → 并行(flight, hotel, activities) → budgeting → supervisor → END`。
3. 本阶段**不改动 LangGraph 拓扑、不改动 Agent 业务逻辑、不改动工具参数、不接入真实 API**。
4. 多城市实现策略：**在 travelService 层循环调用现有单城市图**，每个城市跑一次完整的 `buildTravelGraph()`，汇总结果后统一调用 budgeting 和 supervisor。理由：不改动 LangGraph 拓扑（核心链路），复用现有 Agent 与工具，最小改动。
5. 本阶段**不新增任何 npm 依赖**。

## 阶段目标

实现**多目的地 / 多城市串联行程**：用户可输入多个城市及每城天数，系统按顺序生成各城市的机票/酒店/活动方案，汇总总预算与完整行程。

**核心能力：**
1. TravelRequest 支持多城市（`destinations: { city, days }[]`）
2. 多城市模式下，按城市顺序生成各城市的 flight/hotel/activities
3. 预算 Agent 汇总所有城市费用 + 城际交通费用
4. supervisor 汇总所有城市生成完整行程方案
5. 前端表单支持多城市输入，结果页按城市分块展示
6. 单城市模式完全兼容（向后兼容）

## 技术栈与依赖约束

### 新增依赖

无。

### 不新增的依赖

- ❌ 不引入任何新依赖

## 目标目录结构

```
packages/shared/src/
├── travel.ts                          # 修改：新增 CityPlan、CityDestination 类型；TravelState 新增 cityPlans；TravelRequest 新增 destinations
├── schemas/
│   └── travelRequest.ts               # 修改：schema 支持 destinations
└── formatter.ts                       # 修改：formatPlan/formatPlanMarkdown 支持多城市
packages/agents/src/agents/
├── budgetingAgent.ts                  # 修改：支持多城市预算汇总（含城际交通）
└── supervisor.ts                      # 修改：支持多城市汇总
apps/api/src/
├── services/
│   ├── travelService.ts               # 修改：多城市循环逻辑
│   └── dbService.ts                   # 修改：savePlan 支持 cityPlans
└── prisma/schema.prisma               # 修改：TravelPlan 新增 cityPlans 字段
apps/web/src/
├── components/
│   ├── PlanForm.tsx                   # 修改：支持多城市输入
│   └── PlanResult.tsx                 # 修改：按城市分块展示
└── api/client.ts                      # 修改：类型定义支持多城市
```

## 核心设计

### 1. 类型扩展（packages/shared/src/travel.ts）

新增类型：

```typescript
/** 多城市目的地（Phase15 新增） */
export interface CityDestination {
  city: string;
  days: number;
}

/** 单个城市的规划结果（Phase15 新增） */
export interface CityPlan {
  city: string;
  days: number;
  flights?: FlightResult;
  hotels?: HotelResult;
  activities?: ActivitiesResult;
}
```

TravelRequest 扩展：

```typescript
export interface TravelRequest {
  destination: string;          // 保留：单城市兼容（多城市时为第一个城市）
  days: number;                 // 保留：单城市兼容（多城市时为所有城市天数之和）
  travelDate: string;
  user_preference?: string;
  budget_limit?: number;
  travel_style?: string;
  destinations?: CityDestination[];  // Phase15 新增：多城市列表
}
```

TravelState 扩展：

```typescript
export interface TravelState {
  request: TravelRequest;
  flights?: FlightResult;       // 保留：单城市兼容（多城市时为第一个城市）
  hotels?: HotelResult;
  activities?: ActivitiesResult;
  budget?: BudgetResult;
  summary?: string;
  toolCalls?: ToolCallRecord[];
  cityPlans?: CityPlan[];       // Phase15 新增：多城市规划结果
}
```

> 向后兼容：单城市模式下 `cityPlans` 为 `undefined`，`flights/hotels/activities` 正常填充；多城市模式下 `cityPlans` 有值，`flights/hotels/activities` 取第一个城市的结果（兼容前端旧逻辑）。

### 2. 多城市检测与循环（travelService.ts）

`generatePlan` 中新增多城市分支：

```typescript
export async function generatePlan(request, mode, format, persistMeta) {
  const destinations = request.destinations;
  const isMultiCity = destinations && destinations.length > 1;

  // 单城市：原有逻辑（完全不变）
  if (!isMultiCity) {
    return generateSingleCityPlan(request, mode, format, persistMeta);
  }

  // 多城市：循环每个城市
  const cityPlans: CityPlan[] = [];
  const allToolCalls: ToolCallRecord[] = [];

  for (const dest of destinations) {
    // 构造单城市 request（复用现有图）
    const cityRequest: TravelRequest = {
      destination: dest.city,
      days: dest.days,
      travelDate: request.travelDate,  // 简化：所有城市用同一出发日期
      user_preference: request.user_preference,
      budget_limit: request.budget_limit,
      travel_style: request.travel_style,
    };

    // 调用完整图（flight/hotel/activities/budgeting/supervisor）
    const app = buildTravelGraph();
    const cityState = await app.invoke({ request: cityRequest });

    cityPlans.push({
      city: dest.city,
      days: dest.days,
      flights: cityState.flights,
      hotels: cityState.hotels,
      activities: cityState.activities,
    });

    if (cityState.toolCalls) {
      allToolCalls.push(...cityState.toolCalls);
    }
  }

  // 构造汇总 state
  const mergedState: TravelState = {
    request,
    cityPlans,
    flights: cityPlans[0]?.flights,
    hotels: cityPlans[0]?.hotels,
    activities: cityPlans[0]?.activities,
    toolCalls: allToolCalls,
  };

  // 调用 budgeting 汇总（多城市逻辑）
  const budgetResult = await budgetingAgent(mergedState);
  mergedState.budget = budgetResult.budget;

  // 调用 supervisor 汇总（多城市逻辑）
  const supervisorResult = await supervisorAgent(mergedState);
  mergedState.summary = supervisorResult.summary;

  // 缓存 + 持久化（与单城市逻辑一致）
  ...
}
```

> 说明：`generateSingleCityPlan` 即原有 `generatePlan` 的单城市逻辑，抽取为内部函数。`generatePlanStream` 同理处理多城市。

### 3. 多城市预算汇总（budgetingAgent.ts）

`budgetingAgent` 新增多城市分支：

```typescript
export async function budgetingAgent(state: TravelState) {
  // 多城市：汇总所有城市 + 城际交通
  if (state.cityPlans && state.cityPlans.length > 1) {
    return computeMultiCityBudget(state);
  }
  // 单城市：原有逻辑（完全不变）
  ...
}

/** 多城市预算计算 */
function computeMultiCityBudget(state: TravelState) {
  const breakdown: CostItem[] = [];
  const cityPlans = state.cityPlans!;

  // 每个城市的费用
  for (const city of cityPlans) {
    // 机票：取首个方案 × 2（往返）
    if (city.flights?.options?.length) {
      const flight = city.flights.options[0];
      breakdown.push({
        category: `机票(${city.city})`,
        description: `${flight.airline} ${flight.flightNo} 往返`,
        amount: flight.price * 2,
      });
    }
    // 酒店：取首个方案 × (days-1) 晚
    if (city.hotels?.options?.length) {
      const hotel = city.hotels.options[0];
      const nights = Math.max(city.days - 1, 1);
      breakdown.push({
        category: `酒店(${city.city})`,
        description: `${hotel.name} × ${nights}晚`,
        amount: hotel.pricePerNight * nights,
      });
    }
    // 活动：所有活动费用总和
    if (city.activities?.itinerary?.length) {
      const cost = city.activities.itinerary.reduce(
        (sum, day) => sum + day.activities.reduce((s, a) => s + a.cost, 0),
        0,
      );
      breakdown.push({
        category: `游玩活动(${city.city})`,
        description: `${city.activities.itinerary.length}天行程`,
        amount: cost,
      });
    }
  }

  // 城际交通：城市间交通费（mock：每段 500 元）
  const interCitySegments = cityPlans.length - 1;
  if (interCitySegments > 0) {
    breakdown.push({
      category: '城际交通',
      description: `${interCitySegments} 段城市间交通`,
      amount: interCitySegments * 500,
    });
  }

  const total = breakdown.reduce((sum, item) => sum + item.amount, 0);

  // 超支判断（复用单城市逻辑）
  ...
  return { budget: { agent: 'BudgetingAgent', total, breakdown, overBudget, warning, suggestions } };
}
```

### 4. 多城市汇总（supervisor.ts）

`supervisorAgent` 新增多城市分支：

```typescript
export async function supervisorAgent(state: TravelState) {
  // 多城市：汇总所有城市
  if (state.cityPlans && state.cityPlans.length > 1) {
    if (!isLLMMode()) {
      const summary = formatPlan(state);  // formatter 需支持多城市
      return { summary };
    }
    // llm 模式：传入所有城市结果
    const userContent = JSON.stringify({
      request: state.request,
      cityPlans: state.cityPlans,
      budget: state.budget ?? null,
    });
    ...
  }
  // 单城市：原有逻辑（完全不变）
  ...
}
```

### 5. DB 改动（schema.prisma）

TravelPlan 新增 `cityPlans` 字段：

```prisma
model TravelPlan {
  ...
  cityPlans      Json?      // Phase15 新增：多城市规划结果
  ...
}
```

`savePlan` 中写入 `cityPlans: state.cityPlans ? (state.cityPlans as unknown) : null`。

### 6. 校验（travelRequest.ts）

`travelRequestSchema` 新增 `destinations` 可选字段：

```typescript
export const travelRequestSchema = z.object({
  destination: z.string().trim().min(1, 'destination 为必填项'),
  days: z.number().int().positive(),
  travelDate: z.string().trim().min(1, 'travelDate 为必填项'),
  user_preference: z.string().trim().optional().nullable()...,
  budget_limit: z.number().positive().optional().nullable()...,
  travel_style: z.string().trim().optional().nullable()...,
  // Phase15 新增：多城市
  destinations: z
    .array(
      z.object({
        city: z.string().trim().min(1, '城市名不能为空'),
        days: z.number().int().positive('每城天数必须为正整数'),
      }),
    )
    .min(2, '多城市至少需要 2 个城市')
    .optional(),
});
```

### 7. 前端改动

**PlanForm.tsx**：
- 新增「多城市」开关
- 开启后显示城市列表（可添加/删除城市，每城输入城市名和天数）
- 关闭时为单城市模式（原有 UI 不变）

**PlanResult.tsx**：
- 检测 `result.cityPlans`
- 多城市模式：按城市分块展示（每个城市一个 Card，内含该城市的机票/酒店/活动）
- 单城市模式：原有 Tabs 展示（不变）

**client.ts**：
- `PlanRequest` 类型支持 `destinations` 字段

## API 响应格式

### POST /api/plan

**请求体（多城市）：**
```json
{
  "destination": "北京",
  "days": 6,
  "travelDate": "2026-10-01",
  "destinations": [
    { "city": "北京", "days": 3 },
    { "city": "上海", "days": 3 }
  ]
}
```

**响应（多城市）：** 在原有字段基础上新增 `cityPlans`：
```json
{
  "request": { ... },
  "cityPlans": [
    {
      "city": "北京",
      "days": 3,
      "flights": { ... },
      "hotels": { ... },
      "activities": { ... }
    },
    {
      "city": "上海",
      "days": 3,
      "flights": { ... },
      "hotels": { ... },
      "activities": { ... }
    }
  ],
  "budget": { "total": ..., "breakdown": [...] },
  "summary": "...",
  "toolCalls": [...]
}
```

> 单城市请求/响应格式完全不变。

## 缓存兼容性

- 多城市模式下，`planResultKey` 需包含 `destinations`，确保不同城市组合的缓存键不同
- `planResultKey` 现有实现基于 `request` 生成 JSON 键，`destinations` 会自然包含在内，无需额外改动

## 交付标准

1. `pnpm build` 成功，无 TypeScript 错误。
2. `prisma db push` 成功，TravelPlan 表新增 `cityPlans` 字段。
3. 单城市规划行为不变（向后兼容）。
4. 多城市规划返回 `cityPlans` 数组，每个城市包含 flights/hotels/activities。
5. 多城市预算包含所有城市费用 + 城际交通费。
6. 多城市 summary 包含所有城市的行程方案。
7. 前端表单可添加多个城市并提交。
8. 前端结果页按城市分块展示多城市规划。
9. 多城市模式下 toolCalls 包含所有城市的工具调用记录。
10. 无新增 npm 依赖。

## 禁止清单

1. ❌ 禁止改动 LangGraph 拓扑（buildGraph.ts）。
2. ❌ 禁止改动 flight/hotel/activities Agent 的业务逻辑与工具调用。
3. ❌ 禁止改动工具参数的 JSON Schema。
4. ❌ 禁止改动 `TravelState` 中 flights/hotels/activities 的类型（仅新增 cityPlans）。
5. ❌ 禁止改动现有单城市规划流程。
6. ❌ 禁止引入任何新依赖。
7. ❌ 禁止改动缓存键规则与 TTL。
8. ❌ 禁止改动 `docker-compose.yml`、Dockerfile、nginx.conf。

## 工作流强制规则

1. 增量开发顺序：
   1. 修改 `travel.ts`：新增 CityPlan、CityDestination 类型，扩展 TravelRequest/TravelState
   2. 修改 `travelRequest.ts`：schema 支持 destinations
   3. 修改 `schema.prisma`：新增 cityPlans 字段 + prisma db push
   4. 修改 `budgetingAgent.ts`：新增多城市预算计算
   5. 修改 `supervisor.ts`：新增多城市汇总
   6. 修改 `formatter.ts`：支持多城市格式化
   7. 修改 `travelService.ts`：多城市循环逻辑
   8. 修改 `dbService.ts`：savePlan 支持 cityPlans
   9. 修改前端：PlanForm 多城市输入 + PlanResult 多城市展示
   10. 验证：单城市兼容 + 多城市规划 + 预算汇总 + 前端展示
2. 优先验证单城市规划不受影响，再验证多城市。
3. 必须验证：多城市预算包含城际交通费。
4. 任何超出本 Spec 范围的改动，停止开发，等待确认。
