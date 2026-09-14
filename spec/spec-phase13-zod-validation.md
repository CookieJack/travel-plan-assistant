# spec-phase13-zod-validation.md

## 阶段前提

1. Phase0–Phase12 全部完成：多 Agent 架构稳定，工具调用链路覆盖 flight/hotel/activities，SSE 流式规划与执行可视化可用，toolCalls 已持久化。
2. 当前校验为**手写实现**：
   - `apps/api/src/routes/plan.ts` 的 `parseRequestBody()` 手写校验 `TravelRequest`
   - `packages/shared/src/travel.ts` 的 `validateFlightOutput` / `validateHotelOutput` / `validateActivitiesOutput` / `validateBudgetOutput` 手写类型守卫
   - `apps/api/src/routes/plans.ts` 的 `parsePage` / `parsePageSize` 手写校验分页参数
3. 本阶段**不改动多 Agent 架构、不修改 LangGraph 拓扑、不改动 Agent 业务逻辑、不接入真实 API**。
4. 本阶段**仅引入 `zod` 一个新依赖**，用于统一运行时校验层。

## 阶段目标

引入 `zod` 建立**统一校验层**，替换所有手写校验，为后续 Phase14–17 的新增 API 入参提供标准化校验能力。

**核心原则：**
1. **统一入口**：所有 API 入参校验走 `validate(schema, data)` 统一函数，错误响应格式一致。
2. **向后兼容**：`validateFlightOutput` 等导出函数签名不变，内部改为 zod 实现，Agent 侧调用代码无需改动。
3. **最小改动**：只替换校验逻辑，不改动业务流程、不改动数据结构、不改动 API 响应格式。

## 技术栈与依赖约束

### 新增依赖

| 包 | 版本 | 用途 | 安装位置 |
|---|---|---|---|
| `zod` | ^4.6.1 | 运行时类型校验，替代手写校验与类型守卫 | `packages/shared`（schema 定义 + validate 函数运行时依赖） |

> 说明：`zod` 安装在 `packages/shared` 而非 `apps/api`，因为 Agent 输出校验（`validateFlightOutput` 等）定义在 shared 包中，且运行时需要 zod 解析。`apps/api` 通过 `@travel/shared` 间接获得校验能力。

### 不新增的依赖

- ❌ 不引入 `@hono/zod-validator`（用自定义 `validate()` 函数即可，保持轻量）
- ❌ 不引入其他校验库

## 目标目录结构

```
packages/shared/src/
├── schemas/                      # 新增：zod schema 集中定义
│   ├── travelRequest.ts          # 新增：TravelRequest 入参 schema
│   ├── pagination.ts             # 新增：分页参数 schema
│   ├── agentOutput.ts            # 新增：Agent 输出 schema（替换手写类型守卫）
│   └── index.ts                  # 新增：统一导出
├── lib/
│   └── validate.ts               # 新增：统一 validate 函数 + ZodError 格式化
├── travel.ts                     # 修改：删除手写类型守卫，改为从 schemas 导入并重新导出同名函数
└── index.ts                      # 修改：导出 schemas 与 validate

apps/api/src/
├── index.ts                      # 修改：全局错误处理中统一格式化 ZodError
└── routes/
    ├── plan.ts                   # 修改：parseRequestBody 改用 zod
    ├── planStream.ts             # 无需改动（已复用 parseRequestBody）
    └── plans.ts                  # 修改：parsePage/parsePageSize 改用 zod
```

## 核心设计

### 1. 统一校验函数（packages/shared/src/lib/validate.ts）

```typescript
import { ZodError, type ZodSchema } from 'zod';

/** 校验失败时的结构化错误 */
export interface ValidationError {
  code: 'VALIDATION_ERROR';
  message: string;
  /** 字段级错误详情 */
  details: Array<{ field: string; message: string }>;
}

/**
 * 统一校验函数
 * @param schema zod schema
 * @param data 待校验数据
 * @returns 校验通过返回解析后的数据；失败抛出 ValidationError
 */
export function validate<T>(schema: ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw formatZodError(result.error);
  }
  return result.data;
}

/**
 * 安全校验（不抛异常，返回结果对象）
 * 适用于需要分支处理的场景（如 LLM 输出校验失败时回退 mock）
 */
export function safeValidate<T>(
  schema: ZodSchema<T>,
  data: unknown,
): { success: true; data: T } | { success: false; error: ValidationError } {
  const result = schema.safeParse(data);
  if (!result.success) {
    return { success: false, error: formatZodError(result.error) };
  }
  return { success: true, data: result.data };
}

/** 将 ZodError 格式化为统一的 ValidationError */
function formatZodError(error: ZodError): ValidationError {
  const details = error.issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
  }));
  return {
    code: 'VALIDATION_ERROR',
    message: details.length > 0 ? details[0].message : '参数校验失败',
    details,
  };
}

/** 判断是否为校验错误 */
export function isValidationError(err: unknown): err is ValidationError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === 'VALIDATION_ERROR'
  );
}
```

### 2. TravelRequest 入参 schema（packages/shared/src/schemas/travelRequest.ts）

```typescript
import { z } from 'zod';

/**
 * TravelRequest 入参校验 schema
 * 与 packages/shared/src/travel.ts 中的 TravelRequest 接口保持一致
 */
export const travelRequestSchema = z.object({
  destination: z
    .string({ required_error: 'destination 为必填项' })
    .trim()
    .min(1, 'destination 不能为空'),
  days: z
    .number({ required_error: 'days 为必填项' })
    .int('days 必须为整数')
    .positive('days 必须为正整数'),
  travelDate: z
    .string({ required_error: 'travelDate 为必填项' })
    .trim()
    .min(1, 'travelDate 不能为空'),
  user_preference: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v === null ? undefined : v)),
  budget_limit: z
    .number()
    .positive('budget_limit 必须为正数')
    .optional()
    .nullable()
    .transform((v) => (v === null ? undefined : v)),
  travel_style: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v === null ? undefined : v)),
});

export type TravelRequestInput = z.infer<typeof travelRequestSchema>;
```

> 说明：
> - `.trim()` 自动去除首尾空格（替代手写 `.trim()`）
> - `.nullable().transform(v => v === null ? undefined : v)` 兼容前端传 `null` 的情况，统一转为 `undefined`（与现有 `parseRequestBody` 行为一致）
> - zod v4 的 `required_error` 直接在 `z.string()` / `z.number()` 的第一个参数传入

### 3. 分页参数 schema（packages/shared/src/schemas/pagination.ts）

```typescript
import { z } from 'zod';

/** 列表查询分页参数 */
export const paginationSchema = z.object({
  page: z
    .string()
    .optional()
    .transform((v) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1) return 1;
      return n;
    }),
  pageSize: z
    .string()
    .optional()
    .transform((v) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1) return 10;
      return Math.min(n, 50);
    }),
  destination: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : undefined)),
});

export type PaginationInput = z.infer<typeof paginationSchema>;
```

### 4. Agent 输出 schema（packages/shared/src/schemas/agentOutput.ts）

替换 `travel.ts` 中的手写类型守卫。**保持导出函数签名不变**，内部改用 zod 实现。

```typescript
import { z } from 'zod';
import type {
  FlightOption,
  HotelOption,
  DayItinerary,
  CostItem,
} from '../travel.js';

// ---- 机票输出 ----
const flightOptionSchema = z.object({
  airline: z.string(),
  flightNo: z.string(),
  departTime: z.string(),
  arriveTime: z.string(),
  price: z.number(),
  cabin: z.string(),
});

const flightOutputSchema = z.object({
  options: z.array(flightOptionSchema),
});

/** 校验机票 Agent 的 LLM 输出（签名与原 validateFlightOutput 一致） */
export function validateFlightOutput(data: unknown): data is { options: FlightOption[] } {
  return flightOutputSchema.safeParse(data).success;
}

// ---- 酒店输出 ----
const hotelOptionSchema = z.object({
  name: z.string(),
  star: z.number(),
  roomType: z.string(),
  pricePerNight: z.number(),
  location: z.string(),
});

const hotelOutputSchema = z.object({
  options: z.array(hotelOptionSchema),
});

export function validateHotelOutput(data: unknown): data is { options: HotelOption[] } {
  return hotelOutputSchema.safeParse(data).success;
}

// ---- 活动输出 ----
const activityItemSchema = z.object({
  time: z.string(),
  name: z.string(),
  description: z.string(),
  cost: z.number(),
});

const dayItinerarySchema = z.object({
  day: z.number(),
  activities: z.array(activityItemSchema),
});

const activitiesOutputSchema = z.object({
  itinerary: z.array(dayItinerarySchema),
});

export function validateActivitiesOutput(
  data: unknown,
): data is { itinerary: DayItinerary[] } {
  return activitiesOutputSchema.safeParse(data).success;
}

// ---- 预算输出 ----
const costItemSchema = z.object({
  category: z.string(),
  description: z.string(),
  amount: z.number(),
});

const budgetOutputSchema = z.object({
  total: z.number(),
  breakdown: z.array(costItemSchema),
  overBudget: z.boolean(),
  warning: z.string().nullable().optional(),
  suggestions: z.array(z.string()).nullable().optional(),
});

export function validateBudgetOutput(
  data: unknown,
): data is {
  total: number;
  breakdown: CostItem[];
  overBudget: boolean;
  warning?: string | null;
  suggestions?: string[] | null;
} {
  return budgetOutputSchema.safeParse(data).success;
}
```

> 说明：
> - 类型 `FlightOption` / `HotelOption` / `DayItinerary` / `CostItem` 从 `travel.ts` 导入（避免重复定义）
> - 函数签名与原手写版本**完全一致**，Agent 侧调用代码无需改动
> - 内部用 `safeParse().success` 实现类型守卫，行为与原手写版本一致

### 5. travel.ts 改造（packages/shared/src/travel.ts）

删除手写的类型守卫函数（`validateFlightOutput` 等）和辅助函数（`isObject` / `isString` / `isNumber` / `isFlightOption` 等），改为从 `schemas/agentOutput.ts` 导入并重新导出：

```typescript
// 删除手写校验函数，改为从 schemas 导入
export {
  validateFlightOutput,
  validateHotelOutput,
  validateActivitiesOutput,
  validateBudgetOutput,
} from './schemas/agentOutput.js';
```

> 接口定义（`TravelRequest` / `FlightOption` 等）保持不变，仅删除手写校验函数。

### 6. plan.ts 改造（apps/api/src/routes/plan.ts）

`parseRequestBody` 改用 zod：

```typescript
import { travelRequestSchema, validate } from '@travel/shared';

export function parseRequestBody(body: unknown): TravelRequest | { error: string } {
  try {
    return validate(travelRequestSchema, body);
  } catch (err) {
    return { error: (err as { message: string }).message };
  }
}
```

> 说明：`parseRequestBody` 的返回签名保持不变（`TravelRequest | { error: string }`），`planStream.ts` 无需改动。

### 7. plans.ts 改造（apps/api/src/routes/plans.ts）

`parsePage` / `parsePageSize` 改用 zod：

```typescript
import { paginationSchema, validate } from '@travel/shared';

plans.get('/', async (c) => {
  const params = validate(paginationSchema, {
    page: c.req.query('page'),
    pageSize: c.req.query('pageSize'),
    destination: c.req.query('destination'),
  });
  // params.page / params.pageSize / params.destination 已校验并转换
  ...
});
```

### 8. 全局错误处理（apps/api/src/index.ts）

在 `app.onError` 中统一处理校验错误：

```typescript
import { isValidationError } from '@travel/shared';

app.onError((err, c) => {
  if (isValidationError(err)) {
    return c.json(
      { error: err.message, code: 'VALIDATION_ERROR', details: err.details },
      400,
    );
  }
  console.error('[App] 未处理异常：', err);
  return c.json(
    { error: `服务器内部错误：${err.message}`, code: 'INTERNAL_ERROR' },
    500,
  );
});
```

## API 响应格式（不变）

本阶段**不修改任何 API 的请求/响应格式**。

- `POST /api/plan`：请求体校验逻辑由手写改为 zod，响应格式不变。
- `POST /api/plan/stream`：复用 `parseRequestBody`，无需改动。
- `GET /api/plans`：分页参数校验由手写改为 zod，响应格式不变。
- `GET /api/plans/:id`：无入参校验，不变。

## 缓存兼容性（不变）

校验逻辑不涉及缓存读写，缓存键规则与 TTL 不变。

## 交付标准

1. `pnpm build` 成功，无 TypeScript 错误。
2. `zod@4.6.1` 已安装在 `packages/shared` 的 `dependencies` 中。
3. `POST /api/plan` 对非法入参返回 `400` + `{ error, code: 'VALIDATION_ERROR' }`，错误消息准确。
4. `GET /api/plans` 对非法分页参数自动回退默认值（page=1, pageSize=10），行为与改造前一致。
5. Agent 输出校验（`validateFlightOutput` 等）行为不变：合法数据通过，非法数据返回 false。
6. mock 与 llm 模式下规划结果与改造前完全一致（校验仅替换实现，不改变业务逻辑）。
7. SSE 流式规划正常工作。
8. 无新增除 `zod` 外的 npm 依赖。
9. 全局错误处理能正确格式化 ZodError 为统一响应。

## 禁止清单

1. ❌ 禁止改动多 Agent 架构、LangGraph 拓扑、Agent 业务逻辑。
2. ❌ 禁止改动 `TravelRequest` / `TravelState` 等数据结构。
3. ❌ 禁止修改任何 API 的请求/响应格式。
4. ❌ 禁止改动工具参数的 JSON Schema（LangChain `tool` 函数仍需 JSON Schema）。
5. ❌ 禁止引入除 `zod` 外的任何新依赖。
6. ❌ 禁止删除或重写现有 mock 逻辑。
7. ❌ 禁止改动缓存键规则与 TTL。
8. ❌ 禁止改动 `docker-compose.yml`、Dockerfile、nginx.conf。

## 工作流强制规则

1. 增量开发顺序：
   1. 安装 `zod@4.6.1` 到 `packages/shared`
   2. 新增 `lib/validate.ts`（统一校验函数）
   3. 新增 `schemas/travelRequest.ts` + `schemas/pagination.ts` + `schemas/agentOutput.ts` + `schemas/index.ts`
   4. 修改 `travel.ts`：删除手写校验，改为从 schemas 导入
   5. 修改 `index.ts`（shared）：导出 schemas 与 validate
   6. 修改 `apps/api/src/routes/plan.ts`：parseRequestBody 改用 zod
   7. 修改 `apps/api/src/routes/plans.ts`：分页参数改用 zod
   8. 修改 `apps/api/src/index.ts`：全局错误处理 ZodError
   9. 验证：mock 模式 + llm 模式规划正常，非法入参返回 400
2. 优先验证 mock 模式规划结果与改造前一致，再验证 llm 模式。
3. 必须验证非法入参场景：缺失 destination、days 非正整数、budget_limit 非正数等，均返回 400。
4. 任何超出本 Spec 范围的改动，停止开发，等待确认。
