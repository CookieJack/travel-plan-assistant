# spec-phase14-plan-revision.md

## 阶段前提

1. Phase0–Phase13 全部完成：多 Agent 架构稳定，工具调用链路覆盖 flight/hotel/activities，SSE 流式规划与执行可视化可用，toolCalls 已持久化，zod 统一校验层已落地。
2. 当前规划为**单次生成、无反馈闭环**：用户提交 TravelRequest → Agent 生成规划 → 展示结果，无修订入口。
3. 本阶段**不改动多 Agent 架构、不修改 LangGraph 拓扑、不改动 Agent 业务逻辑、不接入真实 API**。
4. 修订策略：**全量重算**（不做局部更新）。将用户反馈追加到 `request.user_preference`，重新调用完整规划流程。理由：现有 LangGraph 拓扑固定，不支持局部重跑；全量重算实现简单，面试作品无需复杂局部更新。
5. 本阶段**不新增任何 npm 依赖**（ zod 已在 Phase13 引入，用于反馈内容校验）。

## 阶段目标

实现**用户反馈与规划迭代**闭环：用户对已有规划结果提交反馈，系统基于反馈重新生成规划，并记录修订关系（版本链）。

**核心能力：**
1. 用户可对任意历史规划提交文本反馈，生成修订版规划
2. 修订版规划与原规划通过 `parentId` 形成版本链
3. 支持非流式和流式修订（流式复用现有 SSE 机制）
4. 反馈内容通过 zod 校验
5. 前端结果页增加反馈修订入口，展示修订结果

## 技术栈与依赖约束

### 新增依赖

无。本阶段复用 Phase13 引入的 `zod@^4.6.1`。

### 不新增的依赖

- ❌ 不引入任何新依赖

## 目标目录结构

```
apps/api/prisma/schema.prisma          # 修改：TravelPlan 增加 parentId/feedback 字段
packages/shared/src/schemas/
├── revise.ts                          # 新增：修订请求校验 schema
└── index.ts                           # 修改：导出 revise 相关 schema
apps/api/src/services/
├── travelService.ts                   # 修改：新增 revisePlan / revisePlanStream
└── dbService.ts                       # 修改：savePlan 支持 parentId/feedback
apps/api/src/routes/
└── plans.ts                           # 修改：新增 /:id/revise 和 /:id/revise/stream 路由
apps/web/src/
├── api/client.ts                      # 修改：新增 revisePlan / revisePlanStream
├── components/
│   └── PlanResult.tsx                 # 修改：增加反馈修订区域
└── pages/
    └── PlanPage.tsx                   # 修改：处理修订流程
```

## 核心设计

### 1. DB 改动（schema.prisma）

`TravelPlan` 表新增两个字段：

```prisma
model TravelPlan {
  id             String   @id @default(cuid())
  destination    String
  days           Int
  travelDate     String
  userPreference String?
  budgetLimit    Float?
  travelStyle    String?
  mode           String
  flights        Json?
  hotels         Json?
  activities     Json?
  budget         Json?
  summary        String?
  toolCalls      Json?
  parentId       String?    // Phase14 新增：修订来源的规划 ID（null 表示原始规划）
  feedback       String?    // Phase14 新增：本次修订的反馈内容（parentId 非 null 时有值）
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([destination])
  @@index([createdAt])
  @@index([parentId])       // Phase14 新增：支持按 parentId 查询修订历史
}
```

> 不新建 `PlanRevision` 表，用 `parentId` 字段形成版本链，实现更简单。

### 2. 修订请求校验 schema（packages/shared/src/schemas/revise.ts）

```typescript
import { z } from 'zod';

/** 规划修订请求校验 schema */
export const reviseRequestSchema = z.object({
  feedback: z
    .string({ message: 'feedback 为必填项' })
    .trim()
    .min(1, '反馈内容不能为空')
    .max(1000, '反馈内容不能超过 1000 字'),
  mode: z.enum(['mock', 'llm']).optional(),
});

export type ReviseRequestInput = z.infer<typeof reviseRequestSchema>;
```

### 3. 修订服务（apps/api/src/services/travelService.ts）

新增 `revisePlan` 和 `revisePlanStream`：

```typescript
/**
 * 基于用户反馈修订规划（非流式）
 * @param planId 原规划 ID
 * @param feedback 用户反馈文本
 * @param mode 运行模式（可选，默认复用原规划的 mode）
 */
export async function revisePlan(
  planId: string,
  feedback: string,
  mode?: RunMode,
): Promise<TravelState & PersistMeta> {
  // 1. 查询原规划
  const original = await getPlanById(planId);
  if (!original) {
    throw new Error(`规划不存在：${planId}`);
  }

  // 2. 重组 request
  const request: TravelRequest = {
    destination: original.destination,
    days: original.days,
    travelDate: original.travelDate,
  };
  if (original.userPreference) request.user_preference = original.userPreference;
  if (original.budgetLimit !== null) request.budget_limit = original.budgetLimit;
  if (original.travelStyle) request.travel_style = original.travelStyle;

  // 3. 将反馈追加到 user_preference
  const basePreference = request.user_preference ?? '';
  request.user_preference = basePreference
    ? `${basePreference}\n\n用户反馈：${feedback}`
    : `用户反馈：${feedback}`;

  // 4. 确定运行模式
  const runMode: RunMode = mode ?? (original.mode === 'llm' ? 'llm' : 'mock');

  // 5. 调用现有 generatePlan（传入 parentId 和 feedback 供持久化使用）
  const result = await generatePlan(request, runMode, 'json', {
    parentId: planId,
    feedback,
  });

  return result as TravelState & PersistMeta;
}
```

> `generatePlan` 需扩展可选参数 `persistMeta: { parentId?: string; feedback?: string }`，传递给 `savePlan`。

**流式版本** `revisePlanStream` 逻辑相同，复用 `generatePlanStream`，同样传递 `parentId` 和 `feedback`。

### 4. savePlan 扩展（apps/api/src/services/dbService.ts）

`savePlan` 增加可选参数：

```typescript
export async function savePlan(
  state: TravelState,
  mode: RunMode,
  persistMeta?: { parentId?: string; feedback?: string },
): Promise<{ id: string; createdAt: Date }> {
  const { request } = state;
  const record = await prisma.travelPlan.create({
    data: {
      destination: request.destination,
      days: request.days,
      travelDate: request.travelDate,
      userPreference: request.user_preference ?? null,
      budgetLimit: request.budget_limit ?? null,
      travelStyle: request.travel_style ?? null,
      mode,
      flights: (state.flights as unknown) ?? null,
      hotels: (state.hotels as unknown) ?? null,
      activities: (state.activities as unknown) ?? null,
      budget: (state.budget as unknown) ?? null,
      summary: state.summary ?? null,
      toolCalls: (state.toolCalls as unknown) ?? null,
      parentId: persistMeta?.parentId ?? null,   // Phase14 新增
      feedback: persistMeta?.feedback ?? null,   // Phase14 新增
    },
    ...
  });
}
```

### 5. 路由（apps/api/src/routes/plans.ts）

新增两个路由：

```typescript
// POST /api/plans/:id/revise —— 非流式修订
plans.post('/:id/revise', async (c) => {
  const planId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const { feedback, mode } = validate(reviseRequestSchema, body);
  const result = await revisePlan(planId, feedback, mode);
  return c.json(result);
});

// POST /api/plans/:id/revise/stream —— 流式修订
plans.post('/:id/revise/stream', async (c) => {
  const planId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const { feedback, mode } = validate(reviseRequestSchema, body);
  const stream = revisePlanStream(planId, feedback, mode);
  return streamSSE(c, stream);  // 复用 planStream.ts 的 SSE 响应逻辑
});
```

> SSE 响应逻辑（`streamSSE`）需从 `planStream.ts` 抽取为可复用函数，供 `plans.ts` 调用。

### 6. 前端改动

**api/client.ts**：新增

```typescript
export interface ReviseRequest {
  feedback: string;
  mode?: RunMode;
}

/** 非流式修订规划 */
export async function revisePlan(
  planId: string,
  body: ReviseRequest,
): Promise<JsonPlanResponse> { ... }

/** 流式修订规划 */
export async function revisePlanStream(
  planId: string,
  body: ReviseRequest,
  callbacks?: StreamCallbacks,
): Promise<JsonPlanResponse> { ... }
```

**PlanResult.tsx**：在概览 Tab 下方增加"反馈修订"区域：
- 文本输入框（textarea，最大 1000 字）
- 提交按钮
- 调用 `revisePlanStream`
- 修订过程中展示 ExecutionProgress
- 修订完成后展示新的 PlanResult（可切换查看原规划 vs 修订版）

**PlanPage.tsx**：
- 新增 `revising` 状态和 `revisedResult` 状态
- 修订完成后切换展示修订版结果
- 提供"返回原规划"按钮

## API 响应格式

### POST /api/plans/:id/revise

**请求体：**
```json
{
  "feedback": "预算太高了，换个便宜点的酒店",
  "mode": "mock"
}
```

**响应（200）：** 与 `POST /api/plan` 响应格式完全一致（TravelState + id + createdAt）。

**响应（400）：** 校验失败
```json
{
  "error": "反馈内容不能为空",
  "code": "VALIDATION_ERROR",
  "details": [{ "field": "feedback", "message": "反馈内容不能为空" }]
}
```

**响应（404）：** 规划不存在
```json
{ "error": "规划不存在：xxx", "code": "NOT_FOUND" }
```

### POST /api/plans/:id/revise/stream

SSE 流，事件格式与 `POST /api/plan/stream` 完全一致（start → node_complete → complete）。

## 缓存兼容性

- 修订时 `request.user_preference` 变化 → `planResultKey` 自然不同 → 不会命中原始规划的缓存
- 修订后的新规划正常写入缓存
- 修订后清理列表缓存（复用 `cacheDelByPattern('plan:list:*')`）
- 原规划详情缓存不受影响

## 交付标准

1. `pnpm build` 成功，无 TypeScript 错误。
2. `prisma db push` 成功，TravelPlan 表新增 `parentId`、`feedback` 字段。
3. `POST /api/plans/:id/revise` 对空反馈返回 400。
4. `POST /api/plans/:id/revise` 对不存在的规划 ID 返回 404。
5. `POST /api/plans/:id/revise` 正常返回修订后的规划结果，DB 中新记录的 `parentId` 为原规划 ID，`feedback` 为用户反馈。
6. `POST /api/plans/:id/revise/stream` 返回 SSE 流，事件格式与 `/api/plan/stream` 一致。
7. 修订后的规划 `user_preference` 包含用户反馈内容。
8. 前端结果页可提交反馈，展示修订过程和修订结果。
9. 无新增 npm 依赖。
10. 原有规划生成（`/api/plan`、`/api/plan/stream`）行为不变。

## 禁止清单

1. ❌ 禁止改动多 Agent 架构、LangGraph 拓扑、Agent 业务逻辑。
2. ❌ 禁止改动工具参数的 JSON Schema。
3. ❌ 禁止改动 `TravelState` 数据结构。
4. ❌ 禁止引入任何新依赖。
5. ❌ 禁止改动现有规划生成流程（`generatePlan` / `generatePlanStream` 的核心逻辑），仅扩展可选参数。
6. ❌ 禁止改动缓存键规则与 TTL。
7. ❌ 禁止改动 `docker-compose.yml`、Dockerfile、nginx.conf。
8. ❌ 禁止删除或重写现有 mock 逻辑。

## 工作流强制规则

1. 增量开发顺序：
   1. 修改 `schema.prisma`：新增 `parentId`、`feedback` 字段
   2. 执行 `prisma db push` 同步数据库
   3. 新增 `schemas/revise.ts` + 更新 `schemas/index.ts`
   4. 修改 `dbService.ts`：`savePlan` 支持 `parentId`/`feedback`
   5. 修改 `travelService.ts`：新增 `revisePlan` / `revisePlanStream`，扩展 `generatePlan` / `generatePlanStream` 可选参数
   6. 抽取 `planStream.ts` 的 SSE 响应逻辑为可复用函数
   7. 修改 `plans.ts`：新增修订路由
   8. 修改前端 `api/client.ts`：新增修订 API 封装
   9. 修改前端 `PlanResult.tsx` / `PlanPage.tsx`：增加反馈修订 UI
   10. 验证：非流式修订 + 流式修订 + 校验失败 + 规划不存在 + 前端交互
2. 优先验证 mock 模式修订结果正确，再验证 llm 模式。
3. 必须验证：修订后 DB 记录的 `parentId` 和 `feedback` 字段正确。
4. 任何超出本 Spec 范围的改动，停止开发，等待确认。
