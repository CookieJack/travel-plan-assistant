# spec-phase11-execution-visualization.md

## 阶段前提

1. Phase0–Phase10 全部完成：多 Agent 架构稳定，flightAgent 已接入工具调用链路，`toolCalls` 字段已写入 `TravelState` 并随 `POST /api/plan` 响应返回。
2. 本阶段**不改动多 Agent 架构**（1 主控 + 4 子 Agent 数量不变）、**不修改 LangGraph 工作流图结构**（START → 并行(f/h/a) → budgeting → supervisor → END）。
3. 本阶段**不改动现有 `POST /api/plan` 接口的请求/响应格式**（保持向后兼容，SSE 为新增端点）。
4. 本阶段**不新增任何 npm 依赖**：SSE 由 Hono 原生支持，前端用 `fetch` + `ReadableStream` 手动解析 SSE。
5. 本阶段**仅改造 flightAgent 产出的 toolCalls 可视化**，其余 Agent（hotel/activities/budgeting/supervisor）在 Phase10 中未接入工具，本阶段不为其新增工具。

## 阶段目标

让旅行规划的**执行过程可观测、可追溯**：

1. **SSE 流式规划端点**：新增 `POST /api/plan/stream`，在规划执行过程中实时推送 Agent 节点完成状态与工具调用记录，前端无需等待完整响应即可看到进度。
2. **前端实时执行进度**：规划过程中，前端展示 Agent 节点状态流转（待执行 → 执行中 → 已完成）以及工具调用详情（工具名、参数、结果摘要、调用模式）。
3. **结果页执行过程展示**：规划完成后，在结果页新增「执行过程」标签页，展示完整的 `toolCalls` 记录列表；历史详情页同步支持。
4. **toolCalls 持久化**：将 `toolCalls` 存入数据库，使历史规划详情页也能查看执行过程。

**核心原则：流式与非流式共存，SSE 不影响现有接口；toolCalls 全程随状态流转，可视化只读不改。**

## 技术栈与依赖约束

### 复用已有依赖（不新增）

| 包 | 版本 | 用途 |
|---|---|---|
| hono | ^4.13.7 | SSE 流式响应（`c.streamSSE()` 或手动 `c.stream()`） |
| @langchain/langgraph | ^1.4.14 | `app.stream()` 获取节点级状态更新 |
| @prisma/client | ^7.10.0 | toolCalls 字段持久化 |
| react | ^19.2.8 | 前端实时渲染 |
| @travel/shared | workspace:* | TravelState / ToolCallRecord 类型 |
| @travel/agents | workspace:* | buildTravelGraph |

### 不新增的依赖

- ❌ 不引入 SSE 客户端库（如 `@microsoft/fetch-event-source`），用原生 `fetch` + `ReadableStream`
- ❌ 不引入状态管理库（用 React useState/useReducer）
- ❌ 不引入动画库（用 Tailwind CSS 过渡类）
- ❌ 不引入新的 UI 组件库（复用 shadcn 现有组件）

## 目标目录结构

```
apps/
├── api/
│   ├── prisma/
│   │   └── schema.prisma              # 修改：TravelPlan 新增 toolCalls 字段
│   └── src/
│       ├── index.ts                   # 修改：注册 /api/plan/stream 路由
│       ├── routes/
│       │   ├── plan.ts                # 不变
│       │   ├── planStream.ts          # 新增：SSE 流式规划端点
│       │   └── plans.ts               # 不变
│       └── services/
│           ├── travelService.ts       # 修改：新增流式规划方法
│           └── dbService.ts           # 修改：savePlan 保存 toolCalls
└── web/
    └── src/
        ├── api/
        │   └── client.ts              # 修改：新增 generatePlanStream
        ├── components/
        │   ├── PlanResult.tsx         # 修改：新增「执行过程」标签页
        │   ├── ExecutionProgress.tsx  # 新增：实时执行进度展示
        │   └── ToolCallList.tsx       # 新增：工具调用记录列表
        └── pages/
            └── PlanPage.tsx           # 修改：接入流式规划 + 实时进度
```

## 核心设计

### 1. toolCalls 持久化（apps/api/prisma/schema.prisma + dbService.ts）

#### 1.1 Prisma Schema 变更

在 `TravelPlan` model 中新增 `toolCalls` 字段：

```prisma
model TravelPlan {
  // ... 现有字段不变
  toolCalls      Json?    // Phase11 新增：工具调用记录
  // ...
}
```

> 说明：`toolCalls` 为可选 JSON 字段，存储 `ToolCallRecord[]`。历史记录该字段为 `null`，不影响现有数据。

#### 1.2 savePlan 修改

在 `savePlan` 中写入 `toolCalls`：

```typescript
const record = await prisma.travelPlan.create({
  data: {
    // ... 现有字段
    toolCalls: (state.toolCalls as unknown) ?? null,  // Phase11 新增
  },
});
```

> 说明：`state.toolCalls` 是 `ToolCallRecord[] | undefined`，Prisma Json 字段接受数组。`as unknown` 转换沿用现有 flights/hotels 等字段的处理方式。

#### 1.3 详情接口返回

`GET /api/plans/:id` 无需额外改动——Prisma `findUnique` 默认返回所有字段，`toolCalls` 会自动包含在响应中。前端 `getPlanById` 也无需改动（`PlanDetail extends TravelState` 已含 `toolCalls`）。

### 2. SSE 流式规划端点（apps/api/src/routes/planStream.ts）

#### 2.1 端点定义

```
POST /api/plan/stream?mode={mock|llm}
Content-Type: application/json
Accept: text/event-stream

请求体：TravelRequest（同 POST /api/plan）
响应：text/event-stream
```

#### 2.2 SSE 事件格式

每条事件遵循标准 SSE 格式：

```
event: <事件类型>
data: <JSON 字符串>

```

**事件类型定义**：

| 事件类型 | data 结构 | 触发时机 |
|---|---|---|
| `start` | `{ message: string }` | 规划开始执行（缓存未命中时） |
| `node_complete` | `{ node: string; toolCalls?: ToolCallRecord[] }` | 某个 Agent 节点执行完成，携带该节点产出的 toolCalls |
| `cache_hit` | `{ result: JsonPlanResponse }` | 规划结果命中缓存，直接返回完整结果 |
| `complete` | `{ result: JsonPlanResponse }` | 规划执行完成，返回完整结果（含持久化元信息） |
| `error` | `{ message: string }` | 执行过程中发生错误 |

> 说明：
> - `node_complete` 的 `node` 值为 LangGraph 节点名：`flight_agent` / `hotel_agent` / `activities_agent` / `budgeting_agent` / `supervisor_agent`。
> - 只有 `flight_agent` 在 Phase10 中产出 `toolCalls`，其余节点的 `toolCalls` 字段为 `undefined`。
> - `cache_hit` 与 `complete` 互斥：命中缓存发 `cache_hit`，未命中流式执行后发 `complete`。

#### 2.3 流式规划服务方法（travelService.ts）

新增 `generatePlanStream` 方法，返回异步事件生成器：

```typescript
export async function* generatePlanStream(
  request: TravelRequest,
  mode: RunMode,
): AsyncGenerator<SSEEvent> {
  setMode(mode);
  const cacheKey = planResultKey(request, mode);

  // 1. 查缓存：命中则直接返回
  const cached = await cacheGet<TravelState>(cacheKey);
  if (cached) {
    const meta = await persistPlan(cached, mode);  // 复用持久化逻辑
    yield { type: 'cache_hit', data: { result: { ...cached, ...meta } } };
    return;
  }

  // 2. 未命中：流式执行
  yield { type: 'start', data: { message: '开始生成旅行规划...' } };

  const app = buildTravelGraph();
  let finalState: TravelState = { request };

  // 使用 LangGraph stream 获取节点级更新
  const stream = await app.stream({ request }, { streamMode: 'updates' });
  for await (const chunk of stream) {
    for (const [nodeName, update] of Object.entries(chunk)) {
      // 合并到最终状态
      finalState = { ...finalState, ...update };
      // 发送节点完成事件
      yield {
        type: 'node_complete',
        data: {
          node: nodeName,
          toolCalls: update.toolCalls,
        },
      };
    }
  }

  // 3. 写入缓存
  await cacheSet(cacheKey, finalState, PLAN_RESULT_TTL[mode]);

  // 4. 持久化 + 清理列表缓存
  const meta = await persistPlan(finalState, mode);
  await cacheDelByPattern('plan:list:*');

  // 5. 发送完成事件
  yield { type: 'complete', data: { result: { ...finalState, ...meta } } };
}
```

> 关键设计：
> - `streamMode: 'updates'`：LangGraph 逐节点产出状态增量（`{ [nodeName]: partialState }`），而非每次完整状态，减少传输量。
> - 手动合并 `finalState`：因为 `updates` 模式只给增量，需自行累加得到完整状态。
> - 持久化逻辑抽取为 `persistPlan` 辅助函数，`generatePlan`（非流式）与 `generatePlanStream` 共用，避免重复。
> - 错误处理：`try/catch` 包裹整个生成器，异常时 `yield { type: 'error', ... }` 并结束。

#### 2.4 路由实现（planStream.ts）

使用 Hono 的 SSE 响应能力（`c.streamSSE()` 或手动设置 `Content-Type: text/event-stream` + `c.stream()`）：

```typescript
planStream.post('/', async (c) => {
  // 解析 mode 与请求体（复用 plan.ts 的 parseRequestBody / parseMode）
  const mode = parseMode(c.req.query('mode'));
  const body = await c.req.json().catch(() => null);
  const parsed = parseRequestBody(body);
  if ('error' in parsed) {
    return c.json({ error: parsed.error, code: 'VALIDATION_ERROR' }, 400);
  }

  // 设置 SSE 响应头
  c.header('Content-Type', 'text/event-stream; charset=utf-8');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');
  c.header('X-Accel-Buffering', 'no');  // 禁用 Nginx 缓冲

  // 流式输出
  return c.streamSSE(async (stream) => {
    try {
      for await (const event of generatePlanStream(parsed, mode)) {
        stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event.data),
        });
      }
    } catch (err) {
      stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ message: (err as Error).message }),
      });
    } finally {
      stream.close();
    }
  });
});
```

> 说明：
> - `X-Accel-Buffering: no`：确保 Nginx（Phase9 的 Web 容器）不缓冲 SSE 响应，实时推送到前端。
> - `c.streamSSE` 是 Hono 4.x 提供的 SSE 辅助方法；若版本不支持则降级为 `c.stream()` 手动写入 `event: ...\ndata: ...\n\n`。
> - 请求体校验复用 `plan.ts` 中的 `parseRequestBody` / `parseMode`（需导出或复制，保持最小改动优先导出复用）。

### 3. 前端实时执行进度（apps/web/src/components/ExecutionProgress.tsx）

#### 3.1 组件职责

在规划执行过程中，展示：
1. **Agent 节点状态时间线**：5 个节点（flight / hotel / activities / budgeting / supervisor）的状态流转。
2. **工具调用实时流**：flightAgent 的工具调用记录实时追加展示。

#### 3.2 节点状态定义

```typescript
type NodeStatus = 'pending' | 'running' | 'done';
```

节点执行顺序依据 LangGraph 拓扑：
1. `flight_agent`、`hotel_agent`、`activities_agent`：并行（同时进入 running）
2. `budgeting_agent`：三者全部 done 后进入 running
3. `supervisor_agent`：budgeting done 后进入 running

#### 3.3 组件 Props

```typescript
interface ExecutionProgressProps {
  /** 已完成的节点列表（按完成顺序） */
  completedNodes: string[];
  /** 当前是否正在执行 */
  running: boolean;
  /** 已收到的工具调用记录 */
  toolCalls: ToolCallRecord[];
  /** 执行错误信息（无错误为空字符串） */
  error: string;
}
```

#### 3.4 渲染逻辑

- 节点列表：每个节点显示名称 + 状态图标（pending: 灰色圆圈 / running: 旋转 loading / done: 绿色对勾）。
- 节点名称映射：`flight_agent` → 「机票 Agent」、`hotel_agent` → 「酒店 Agent」、`activities_agent` → 「游玩活动 Agent」、`budgeting_agent` → 「预算 Agent」、`supervisor_agent` → 「主控汇总」。
- 工具调用区：在 flightAgent 完成后显示其 toolCalls，每条记录展示工具名、参数（可折叠）、结果摘要、模式徽标（mock/llm）。

### 4. 前端工具调用列表（apps/web/src/components/ToolCallList.tsx）

#### 4.1 组件职责

展示 `ToolCallRecord[]` 列表，用于：
1. `PlanResult` 的「执行过程」标签页（规划完成后展示完整记录）。
2. `ExecutionProgress` 中的实时工具调用流（复用渲染逻辑）。

#### 4.2 渲染字段

每条工具调用记录展示：

| 字段 | 展示方式 |
|---|---|
| agent | Agent 名称（如 FlightSearchAgent） |
| toolName | 工具名称（如 searchFlights），加粗 |
| args | 参数 JSON，折叠/展开（默认折叠） |
| resultSummary | 结果摘要，灰色小字 |
| mode | 徽标：mock（灰色）/ llm（蓝色） |
| timestamp | 时间，`toLocaleTimeString` |

### 5. PlanResult 新增「执行过程」标签页（apps/web/src/components/PlanResult.tsx）

#### 5.1 Tabs 变更

将 `TabsList` 从 `grid-cols-5` 改为 `grid-cols-6`，新增 `执行过程` 标签：

```
概览 | 机票 | 酒店 | 行程 | 预算 | 执行过程
```

#### 5.2 执行过程 Tab 内容

```tsx
<TabsContent value="process">
  <Card>
    <CardHeader>
      <CardTitle>执行过程</CardTitle>
    </CardHeader>
    <CardContent>
      {result.toolCalls && result.toolCalls.length > 0 ? (
        <ToolCallList toolCalls={result.toolCalls} />
      ) : (
        <p className="text-sm text-muted-foreground">暂无工具调用记录</p>
      )}
    </CardContent>
  </Card>
</TabsContent>
```

> 说明：`result.toolCalls` 来自 `TravelState.toolCalls`。对于 `POST /api/plan` 响应和 `GET /api/plans/:id` 响应（Phase11 持久化后）均可用。

### 6. PlanPage 接入流式规划（apps/web/src/pages/PlanPage.tsx）

#### 6.1 状态扩展

```typescript
const [completedNodes, setCompletedNodes] = useState<string[]>([]);
const [streamToolCalls, setStreamToolCalls] = useState<ToolCallRecord[]>([]);
const [streamError, setStreamError] = useState('');
```

#### 6.2 提交流程改造

`handleSubmit` 改为调用 `generatePlanStream`，通过回调实时更新状态：

```typescript
const handleSubmit = async (request: TravelRequest, mode: RunMode) => {
  setLoading(true);
  setError('');
  setResult(null);
  setCompletedNodes([]);
  setStreamToolCalls([]);
  setStreamError('');

  try {
    const result = await generatePlanStream(request, mode, {
      onNodeComplete: (node, toolCalls) => {
        setCompletedNodes((prev) => [...prev, node]);
        if (toolCalls && toolCalls.length > 0) {
          setStreamToolCalls((prev) => [...prev, ...toolCalls]);
        }
      },
    });
    setResult(result);
  } catch (err) {
    setError(err instanceof Error ? err.message : '规划生成失败');
  } finally {
    setLoading(false);
  }
};
```

#### 6.3 渲染逻辑

- `loading && !result` 时：展示 `<ExecutionProgress />`（替代原来的「正在生成规划方案，请稍候...」纯文本）。
- `!loading && result` 时：展示 `<PlanResult />`。

### 7. API Client 流式方法（apps/web/src/api/client.ts）

#### 7.1 generatePlanStream

使用 `fetch` + `ReadableStream` 手动解析 SSE（因 POST 请求无法使用 `EventSource`）：

```typescript
export interface StreamCallbacks {
  onNodeComplete?: (node: string, toolCalls?: ToolCallRecord[]) => void;
}

export async function generatePlanStream(
  request: TravelRequest,
  mode: RunMode,
  callbacks?: StreamCallbacks,
): Promise<JsonPlanResponse> {
  const res = await fetch(`${API_BASE}/plan/stream?mode=${mode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || '规划生成失败');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult: JsonPlanResponse | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';

    for (const raw of events) {
      const parsed = parseSSEEvent(raw);
      if (!parsed) continue;

      switch (parsed.event) {
        case 'node_complete':
          callbacks?.onNodeComplete?.(parsed.data.node, parsed.data.toolCalls);
          break;
        case 'cache_hit':
        case 'complete':
          finalResult = parsed.data.result;
          break;
        case 'error':
          throw new Error(parsed.data.message);
      }
    }
  }

  if (!finalResult) throw new Error('未收到规划结果');
  return finalResult;
}
```

> 说明：`parseSSEEvent` 为辅助函数，解析 `event: xxx\ndata: {...}` 格式的 SSE 文本块为 `{ event, data }` 对象。

## API 响应格式

### 新增端点

| 端点 | 方法 | Content-Type | 说明 |
|---|---|---|---|
| `/api/plan/stream` | POST | text/event-stream | SSE 流式规划，事件格式见上文 2.2 |

### 现有端点（不变）

- `POST /api/plan`：响应格式不变（仍含 `toolCalls` 字段）。
- `GET /api/plans/:id`：响应新增 `toolCalls` 字段（因 DB 持久化，Prisma 自动返回），不影响现有字段。
- `GET /api/plans`：列表接口不变（不返回 toolCalls）。

## 缓存兼容性（Phase7）

1. **规划结果缓存**：`plan:result:*` 存储完整 `TravelState`（含 `toolCalls`），SSE 端点命中缓存时发 `cache_hit` 事件，结果与非流式一致。
2. **详情缓存**：`plan:detail:*` 存储 DB 记录（含 `toolCalls`），详情页可正常展示。
3. **列表缓存**：新规划完成后清理 `plan:list:*`，逻辑不变。
4. **注意**：Phase10 之前生成的历史记录在 DB 中 `toolCalls` 为 `null`，详情页「执行过程」Tab 显示「暂无工具调用记录」，属预期行为。

## Docker / Nginx 兼容性（Phase9）

1. **Nginx SSE 支持**：需在 `apps/web/nginx.conf` 的 `/api/` location 中确保不缓冲 SSE 响应。通过响应头 `X-Accel-Buffering: no` 控制，无需修改 nginx.conf。
2. **超时**：现有 `proxy_read_timeout 300s` 已覆盖 llm 模式耗时，SSE 长连接在此范围内。
3. **Dockerfile**：无需修改，Hono 原生 SSE 不依赖额外系统库。

## ✅ 本阶段交付标准

1. `pnpm build` 成功，无 TypeScript 错误。
2. `prisma db push` 成功，`TravelPlan` 表新增 `toolCalls` JSON 列。
3. `POST /api/plan/stream` 在 mock 模式下返回 SSE 流，包含：
   - `start` 事件
   - 5 个 `node_complete` 事件（flight / hotel / activities / budgeting / supervisor），其中 flight_agent 事件携带 `toolCalls`
   - `complete` 事件，data.result 为完整规划结果（含 id/createdAt）
4. `POST /api/plan/stream` 在 llm 模式下正常流式返回（需配置 DOUBAO_API_KEY）。
5. 缓存命中时，`POST /api/plan/stream` 直接返回 `cache_hit` 事件，无 `node_complete` 事件。
6. 前端规划页提交后，实时展示 Agent 节点状态流转与工具调用详情，规划完成后展示完整结果。
7. 结果页「执行过程」标签页展示完整 toolCalls 记录（工具名、参数、结果摘要、模式、时间）。
8. 历史详情页（`GET /api/plans/:id`）的「执行过程」标签页正常展示 toolCalls（Phase11 之后生成的记录）。
9. 现有 `POST /api/plan`、`GET /api/plans`、`GET /api/plans/:id` 接口行为不变（toolCalls 为新增字段）。
10. 无新增 npm 依赖。
11. LangGraph 工作流拓扑不变，Agent 内部逻辑不变。
12. Docker 部署正常，SSE 经 Nginx 反代后前端可实时接收（验证 `X-Accel-Buffering: no` 生效）。

## ❌ Phase11 禁止清单

1. ❌ 禁止新增/删减 Agent 角色，禁止修改 LangGraph 调度流程图与节点拓扑。
2. ❌ 禁止修改现有 `POST /api/plan` 接口的请求/响应格式。
3. ❌ 禁止改造除 flightAgent 以外的任何 Agent（不为 hotel/activities/budgeting/supervisor 新增工具）。
4. ❌ 禁止新增 npm 依赖（SSE 用 Hono 原生 + 原生 fetch，不用第三方库）。
5. ❌ 禁止修改 flights/hotels/activities/budget/summary 字段的输出结构。
6. ❌ 禁止修改 buildGraph.ts 的工作流拓扑（节点和边）。
7. ❌ 禁止删除或重写现有 mock 逻辑。
8. ❌ 禁止改动 docker-compose.yml、Dockerfile.api、Dockerfile.web（SSE 无需额外配置）。
9. ❌ 禁止实现多轮工具调用（Phase10 已限定 flightAgent 最多 1 轮）。
10. ❌ 禁止将 toolCalls 用于业务逻辑计算（仅供可视化展示）。
11. ❌ 禁止修改缓存键规则与 TTL（仅复用现有缓存机制）。

## 工作流强制规则

1. 增量开发顺序：Prisma schema + savePlan 持久化 → SSE 端点（travelService 流式方法 + planStream 路由）→ 前端 client 流式解析 → ExecutionProgress 组件 → ToolCallList 组件 → PlanResult 新增 Tab → PlanPage 接入 → 验证。
2. 优先验证 mock 模式下 SSE 流式链路跑通（后端事件 → 前端解析 → 实时展示），再验证 llm 模式。
3. 必须验证缓存命中场景：SSE 端点返回 `cache_hit` 事件，前端直接展示结果无中间节点事件。
4. 必须验证历史详情页：Phase11 后新生成的记录，详情页「执行过程」Tab 有数据；旧记录显示「暂无工具调用记录」。
5. 必须验证 Docker 环境下 SSE 经 Nginx 反代不被缓冲（前端能实时收到事件）。
6. 任何超出本 Spec 范围的改动（如给其他 Agent 加工具、改前端其他页面、加新接口），停止开发，等待确认。
