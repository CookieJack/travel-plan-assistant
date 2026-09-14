# spec-phase18-conversation-storage.md

## 阶段前提

1. Phase0–Phase17 全部完成：多 Agent 规划、多城市、zod 校验、反馈修订、SSE 流式、toolCalls 持久化、用户系统与个性化、Docker 部署、自然语言对话均可用。
2. 当前前端 PlanPage 为**两栏布局**：左侧 ChatPanel 对话面板，右侧 ExecutionProgress + PlanResult。
3. 当前聊天消息仅存在 React state 中，**刷新页面即丢失**，无会话持久化能力。
4. 当前数据库仅有 `TravelPlan`（最终规划结果），无「会话/对话」概念。
5. AGENTS.md 已允许新增「意图识别/信息抽取」类前置节点，本阶段新增会话存储属于数据层扩展，不改变 4 个业务子 Agent 拓扑。
6. 本阶段**不改动 4 个业务子 Agent（flight/hotel/activities/budgeting）的业务逻辑**，**不改动 supervisor 汇总逻辑**，**不改动 intent_agent 抽取逻辑**。

## 阶段目标

实现**会话持久化存储 + 三栏布局**：

1. **数据模型**：新增 `Conversation`（会话）与 `ConversationMessage`（会话消息）表，支持匿名与登录用户。
2. **后端集成**：规划请求（`/api/plan/stream`）支持 `conversationId`，自动创建会话并持久化用户/助手消息；追问与规划结果均落库。
3. **会话 API**：新增会话列表、详情、删除接口。
4. **前端三栏布局**：PlanPage 改为左（会话列表）、中（聊天框）、右（执行输出）三栏。
5. **会话切换**：点击历史会话可恢复消息历史与规划结果；新建会话清空当前状态。

## 技术栈与依赖约束

### 新增依赖

无。复用现有技术栈：
- 数据库：Prisma + PostgreSQL（已有）
- 后端：Hono（已有）
- 前端：React + shadcn（已有）
- 缓存：Redis（会话列表缓存可选，本阶段暂不引入缓存，保持最小改动）

### 不新增的依赖

- ❌ 不引入对话状态管理库
- ❌ 不引入新的前端 UI 库（复用现有 shadcn 组件）
- ❌ 不引入 WebSocket（继续用现有 SSE）

## 目标目录结构

```
apps/api/prisma/
└── schema.prisma                      # 修改：新增 Conversation、ConversationMessage 模型；User 增加 conversations 关系
apps/api/src/
├── routes/
│   ├── conversations.ts               # 新增：会话 CRUD 路由
│   ├── plan.ts                        # 修改：请求体支持 conversationId
│   └── planStream.ts                  # 修改：透传 conversationId
├── services/
│   ├── conversationService.ts         # 新增：会话与消息持久化服务
│   ├── dbService.ts                   # 修改：SavePlanMeta 增加 conversationId
│   └── travelService.ts               # 修改：generatePlan/generatePlanStream 集成会话持久化
├── types/
│   └── api.ts                         # 修改：SSEEvent 增加 conversationId
└── index.ts                           # 修改：注册 conversations 路由
packages/shared/src/
└── travel.ts                          # 修改：TravelRequest 新增 conversationId 可选字段
apps/web/src/
├── components/
│   └── SessionList.tsx                # 新增：左侧会话列表组件
├── api/
│   └── client.ts                      # 修改：新增会话 API + conversationId 透传
└── pages/
    └── PlanPage.tsx                   # 修改：三栏布局 + 会话切换逻辑
```

## 核心设计

### 1. 数据模型（apps/api/prisma/schema.prisma）

```prisma
// Phase18 新增：会话模型
model Conversation {
  id        String   @id @default(cuid())
  userId    String?  // 关联用户（null 为匿名会话，与 TravelPlan.userId 语义一致）
  user      User?    @relation(fields: [userId], references: [id])
  title     String   // 会话标题（取第一条用户消息前 20 字）
  planId    String?  // 关联的最终规划 ID（一个会话对应一个规划）
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  messages ConversationMessage[]

  @@index([userId])
  @@index([createdAt])
}

// Phase18 新增：会话消息模型
model ConversationMessage {
  id             String       @id @default(cuid())
  conversationId String
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  role           String       // 'user' | 'assistant'
  content        String       // 消息文本内容
  type           String       // 'text' | 'clarification' | 'plan_result'
  planId         String?      // type=plan_result 时关联的规划 ID
  data           Json?        // 结构化附加数据：clarification 时存 extractedFields
  createdAt      DateTime     @default(now())

  @@index([conversationId])
  @@index([createdAt])
}
```

User 模型增加：

```prisma
model User {
  // ... 现有字段
  conversations Conversation[]  // Phase18 新增
  plans TravelPlan[]
}
```

> 说明：
> - `Conversation.planId` 为 null 表示会话尚未生成最终规划（仍在追问中）。
> - `ConversationMessage.data` 用于存 `extractedFields`，便于恢复追问状态。
> - 删除会话时级联删除其消息（`onDelete: Cascade`）。

### 2. TravelRequest 扩展（packages/shared/src/travel.ts）

```typescript
export interface TravelRequest {
  // ... 现有字段（destination/days/travelDate/...）
  // Phase17 字段
  naturalLanguage?: string;
  clarificationHistory?: ClarificationMessage[];
  // Phase18 新增：关联的会话 ID（null/undefined 表示新建会话）
  conversationId?: string;
}
```

> `conversationId` 为可选字段，向后兼容：未传时后端自动创建新会话。

### 3. 会话服务（apps/api/src/services/conversationService.ts）

```typescript
import { prisma } from '../lib/prisma.js';
import type { TravelRequest } from '@travel/shared';

/** 会话标题最大长度 */
const TITLE_MAX_LENGTH = 20;

/** 截断用户消息生成会话标题 */
function makeTitle(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length > TITLE_MAX_LENGTH
    ? trimmed.slice(0, TITLE_MAX_LENGTH) + '…'
    : trimmed;
}

/** 创建会话（第一条用户消息时调用） */
export async function createConversation(
  userId: string | undefined,
  firstUserMessage: string,
): Promise<{ id: string; title: string }> {
  const conv = await prisma.conversation.create({
    data: {
      userId: userId ?? null,
      title: makeTitle(firstUserMessage),
    },
    select: { id: true, title: true },
  });
  return conv;
}

/** 追加消息到会话 */
export async function addMessage(params: {
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  type: 'text' | 'clarification' | 'plan_result';
  planId?: string;
  data?: unknown;
}): Promise<void> {
  await prisma.conversationMessage.create({
    data: {
      conversationId: params.conversationId,
      role: params.role,
      content: params.content,
      type: params.type,
      planId: params.planId ?? null,
      data: params.data ? (params.data as object) : null,
    },
  });
}

/** 更新会话关联的规划 ID */
export async function attachPlanToConversation(
  conversationId: string,
  planId: string,
): Promise<void> {
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { planId },
  });
}

/** 会话列表项 */
export interface ConversationListItem {
  id: string;
  title: string;
  planId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 查询会话列表（按用户过滤，未登录返回匿名会话） */
export async function listConversations(
  userId: string | undefined,
): Promise<ConversationListItem[]> {
  return prisma.conversation.findMany({
    where: { userId: userId ?? null },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      title: true,
      planId: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

/** 会话详情（含消息） */
export interface ConversationDetail {
  id: string;
  title: string;
  planId: string | null;
  createdAt: Date;
  updatedAt: Date;
  messages: Array<{
    id: string;
    role: string;
    content: string;
    type: string;
    planId: string | null;
    data: unknown;
    createdAt: Date;
  }>;
}

/** 查询会话详情 */
export async function getConversation(
  id: string,
  userId: string | undefined,
): Promise<ConversationDetail | null> {
  const conv = await prisma.conversation.findFirst({
    where: { id, userId: userId ?? null },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          role: true,
          content: true,
          type: true,
          planId: true,
          data: true,
          createdAt: true,
        },
      },
    },
  });
  return conv;
}

/** 删除会话（级联删除消息） */
export async function deleteConversation(
  id: string,
  userId: string | undefined,
): Promise<boolean> {
  const result = await prisma.conversation.deleteMany({
    where: { id, userId: userId ?? null },
  });
  return result.count > 0;
}
```

### 4. travelService.ts 集成会话持久化

**SavePlanMeta 扩展（dbService.ts）：**

```typescript
export interface SavePlanMeta {
  parentId?: string;
  feedback?: string;
  userId?: string;
  conversationId?: string;  // Phase18 新增
}
```

**generatePlanStream 改动：**

在函数签名中，`persistMeta` 已支持 `conversationId`。需要在规划流程中：

1. 入口处：确保会话存在，保存用户消息
2. 追问分支：保存助手追问消息（type=clarification，data=extractedFields）
3. 规划完成分支：保存助手结果消息（type=plan_result，planId=result.id），更新会话 planId

```typescript
export async function* generatePlanStream(
  request: TravelRequest,
  mode: RunMode = 'mock',
  persistMeta?: SavePlanMeta,
): AsyncGenerator<SSEEvent> {
  setMode(mode);
  await applyUserPreferences(request, persistMeta?.userId);

  // Phase18：确保会话存在并保存用户消息
  let conversationId = request.conversationId;
  if (!conversationId) {
    const conv = await createConversation(
      persistMeta?.userId,
      request.naturalLanguage ?? '新会话',
    );
    conversationId = conv.id;
  }
  await addMessage({
    conversationId,
    role: 'user',
    content: request.naturalLanguage ?? '',
    type: 'text',
  });

  // Phase17：自然语言抽取
  let activeRequest = request;
  if (request.naturalLanguage) {
    const intentResult = await intentAgent({ request });
    if (intentResult.needClarification) {
      // Phase18：保存助手追问消息
      await addMessage({
        conversationId,
        role: 'assistant',
        content: intentResult.clarificationQuestion ?? '请补充旅行信息',
        type: 'clarification',
        data: intentResult.extractedFields,
      });
      yield {
        type: 'clarification',
        data: {
          question: intentResult.clarificationQuestion ?? '请补充旅行信息',
          extractedFields: intentResult.extractedFields ?? {},
          conversationId,  // Phase18：返回会话 ID
        },
      };
      return;
    }
    activeRequest = { ...intentResult.request };
    activeRequest.naturalLanguage = undefined;
    activeRequest.clarificationHistory = undefined;
  }

  // ... 缓存查询、Agent 执行（原有逻辑不变）

  // 规划完成后持久化 + 关联会话
  const meta = await persistPlan(finalState, mode, persistMeta);
  // Phase18：保存助手结果消息 + 关联 planId
  await addMessage({
    conversationId,
    role: 'assistant',
    content: '已为您生成旅行规划方案：',
    type: 'plan_result',
    planId: meta.id,
  });
  await attachPlanToConversation(conversationId, meta.id);
  await cacheDelByPattern('plan:list:*');

  yield {
    type: 'complete',
    data: { result: { ...finalState, ...meta }, conversationId },
  };
}
```

> cache_hit 分支同样需要保存消息并返回 conversationId。
> 非流式 `generatePlan` 同步相同逻辑（保存消息 + 返回 conversationId）。

### 5. SSE 事件类型扩展（apps/api/src/types/api.ts 或 travelService.ts）

```typescript
export type SSEEvent =
  | { type: 'start'; data: { message: string } }
  | { type: 'node_complete'; data: { node: string; toolCalls?: TravelState['toolCalls'] } }
  | { type: 'cache_hit'; data: { result: TravelState & PersistMeta; conversationId: string } }
  | { type: 'complete'; data: { result: TravelState & PersistMeta; conversationId: string } }
  | { type: 'clarification'; data: { question: string; extractedFields: Partial<TravelRequest>; conversationId: string } }
  | { type: 'error'; data: { message: string } };
```

### 6. 会话 API 路由（apps/api/src/routes/conversations.ts）

```
GET    /api/conversations          会话列表
GET    /api/conversations/:id      会话详情（含消息）
DELETE /api/conversations/:id      删除会话
```

```typescript
import { Hono } from 'hono';
import { optionalAuth } from '../middleware/auth.js';
import {
  listConversations,
  getConversation,
  deleteConversation,
} from '../services/conversationService.js';

const conversations = new Hono();

// GET /api/conversations
conversations.get('/', optionalAuth, async (c) => {
  const userId = c.get('userId');
  const items = await listConversations(userId);
  return c.json({ items });
});

// GET /api/conversations/:id
conversations.get('/:id', optionalAuth, async (c) => {
  const id = c.req.param('id');
  const userId = c.get('userId');
  const conv = await getConversation(id, userId);
  if (!conv) {
    return c.json({ error: '会话不存在', code: 'NOT_FOUND' }, 404);
  }
  return c.json(conv);
});

// DELETE /api/conversations/:id
conversations.delete('/:id', optionalAuth, async (c) => {
  const id = c.req.param('id');
  const userId = c.get('userId');
  const deleted = await deleteConversation(id, userId);
  if (!deleted) {
    return c.json({ error: '会话不存在', code: 'NOT_FOUND' }, 404);
  }
  return c.json({ success: true });
});

export { conversations };
```

**index.ts 注册：** `app.route('/api/conversations', conversations);`

### 7. plan.ts / planStream.ts 改动

- `parseRequestBody` 透传 `conversationId`（travelRequestSchema 已包含可选字段）
- `planStream.ts` 将 `request.conversationId` 传入 `generatePlanStream` 的 `persistMeta`

实际上 `conversationId` 在 `TravelRequest` 中，`persistMeta` 从 `request.conversationId` 读取即可，无需额外改路由。

### 8. 前端 API 封装（apps/web/src/api/client.ts）

新增会话 API：

```typescript
/** 会话列表项 */
export interface ConversationItem {
  id: string;
  title: string;
  planId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 会话消息 */
export interface ConversationMessageItem {
  id: string;
  role: string;
  content: string;
  type: string;
  planId: string | null;
  data: unknown;
  createdAt: string;
}

/** 会话详情 */
export interface ConversationDetail {
  id: string;
  title: string;
  planId: string | null;
  createdAt: string;
  updatedAt: string;
  messages: ConversationMessageItem[];
}

/** 获取会话列表 */
export async function listConversations(): Promise<{ items: ConversationItem[] }> {
  const res = await fetch(`${API_BASE}/conversations`, { headers: authHeaders() });
  const data = await res.json();
  if (!res.ok) throw new Error((data as ErrorResponse).error || '获取会话列表失败');
  return data;
}

/** 获取会话详情 */
export async function getConversation(id: string): Promise<ConversationDetail> {
  const res = await fetch(`${API_BASE}/conversations/${id}`, { headers: authHeaders() });
  const data = await res.json();
  if (!res.ok) throw new Error((data as ErrorResponse).error || '获取会话详情失败');
  return data;
}

/** 删除会话 */
export async function deleteConversation(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/conversations/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as ErrorResponse).error || '删除会话失败');
  }
}
```

`ClarificationResult` 增加 `conversationId`：

```typescript
export interface ClarificationResult {
  needClarification: true;
  question: string;
  extractedFields: Partial<TravelRequest>;
  conversationId: string;  // Phase18 新增
}
```

`JsonPlanResponse` 增加 `conversationId`（或通过 SSE 事件携带，流式路径下从 complete 事件 data.conversationId 取）。

流式回调 `StreamCallbacks` 增加 `onConversationId`：

```typescript
export interface StreamCallbacks {
  onNodeComplete?: (node: string, toolCalls?: ToolCallRecord[]) => void;
  onClarification?: (question: string, extractedFields: Partial<TravelRequest>) => void;
  onConversationId?: (conversationId: string) => void;  // Phase18 新增
}
```

`generatePlanStream` 解析 clarification / complete / cache_hit 事件时，提取 `conversationId` 并通过 callback 传出，同时赋给返回结果。

### 9. 前端三栏布局（apps/web/src/pages/PlanPage.tsx）

```
┌──────────────┬──────────────────────────┬──────────────────────────┐
│  会话列表     │       聊天框              │      执行输出             │
│              │                          │                          │
│  [+ 新建会话] │   消息列表                │   ExecutionProgress       │
│              │   ...                    │                          │
│  会话1 ✓     │                          │   PlanResult              │
│  会话2       │   输入框                  │                          │
│  会话3       │                          │                          │
└──────────────┴──────────────────────────┴──────────────────────────┘
```

**布局：** `grid grid-cols-[260px_1fr_1fr]`（左固定 260px，中右各占剩余），小屏降级为单列。

**PlanPage 状态：**

```typescript
// 会话相关
const [conversations, setConversations] = useState<ConversationItem[]>([]);
const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
// 现有状态（messages/loading/mode/result/...）
```

**核心流程：**

1. **进入页面**：调用 `listConversations()` 加载会话列表，默认无选中会话（空状态）。
2. **新建会话**：点击「新建会话」按钮 → `activeConversationId = null`，清空 messages/result/pendingFields。
3. **发送消息**：
   - 若 `activeConversationId` 为 null，请求不带 conversationId，后端创建新会话。
   - 收到 SSE 事件中的 conversationId 后，设置 `activeConversationId` 并刷新会话列表。
4. **切换会话**：
   - 点击会话项 → `setActiveConversationId(id)`
   - 调用 `getConversation(id)` 加载消息
   - 将后端消息转为 `ChatMessage[]`（assistant 的 plan_result 消息带 planId）
   - 若 `conversation.planId` 存在，调用 `getPlanById(planId)` 加载规划结果展示在右栏
   - 若最后一条是 clarification 消息，从其 `data` 恢复 `pendingFields`
5. **删除会话**：会话项 hover 显示删除按钮 → 调用 `deleteConversation` → 刷新列表 → 若删除的是当前会话，清空状态。

**消息转换规则：**

| 后端 message.type | 前端 ChatMessage |
|---|---|
| user / text | `{ role: 'user', content }` |
| assistant / clarification | `{ role: 'assistant', content }` |
| assistant / plan_result | `{ role: 'assistant', content, planId }` |

### 10. SessionList 组件（apps/web/src/components/SessionList.tsx）

```tsx
interface SessionListProps {
  conversations: ConversationItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}
```

- 顶部「新建会话」按钮
- 会话列表：标题 + 更新时间，当前选中高亮
- 每项 hover 显示删除图标
- 空状态提示「还没有会话」

## API 响应格式

### GET /api/conversations

```json
{
  "items": [
    {
      "id": "clx...",
      "title": "国庆去成都玩5天",
      "planId": "clx...",
      "createdAt": "2026-09-11T10:00:00.000Z",
      "updatedAt": "2026-09-11T10:05:00.000Z"
    }
  ]
}
```

### GET /api/conversations/:id

```json
{
  "id": "clx...",
  "title": "国庆去成都玩5天",
  "planId": "clx...",
  "createdAt": "2026-09-11T10:00:00.000Z",
  "updatedAt": "2026-09-11T10:05:00.000Z",
  "messages": [
    {
      "id": "msg1",
      "role": "user",
      "content": "国庆去成都玩5天",
      "type": "text",
      "planId": null,
      "data": null,
      "createdAt": "2026-09-11T10:00:00.000Z"
    },
    {
      "id": "msg2",
      "role": "assistant",
      "content": "请补充以下信息：出行日期",
      "type": "clarification",
      "planId": null,
      "data": { "destination": "成都", "days": 5, "travelDate": "" },
      "createdAt": "2026-09-11T10:00:01.000Z"
    }
  ]
}
```

### POST /api/plan/stream 响应（clarification 事件）

```json
{
  "type": "clarification",
  "data": {
    "question": "请补充以下信息：出行日期",
    "extractedFields": { "destination": "成都", "days": 5, "travelDate": "" },
    "conversationId": "clx..."
  }
}
```

### POST /api/plan/stream 响应（complete 事件）

```json
{
  "type": "complete",
  "data": {
    "result": { /* TravelState + id/createdAt */ },
    "conversationId": "clx..."
  }
}
```

## 交付标准

1. `pnpm build` 成功，无 TypeScript 错误。
2. `prisma db push` 成功创建 Conversation 与 ConversationMessage 表。
3. 用户发送第一条消息后，数据库生成 Conversation 记录（title 为用户消息前 20 字）。
4. 追问场景：ConversationMessage 表新增一条 user 消息 + 一条 assistant(clarification) 消息，data 字段含 extractedFields。
5. 规划完成场景：新增 assistant(plan_result) 消息，Conversation.planId 被更新为规划 ID。
6. GET /api/conversations 返回当前用户的会话列表（未登录返回匿名会话）。
7. GET /api/conversations/:id 返回会话详情及按时间正序排列的消息。
8. DELETE /api/conversations/:id 删除会话及其所有消息（级联）。
9. 前端三栏布局正常显示：左会话列表、中聊天框、右执行输出。
10. 切换历史会话能恢复消息历史；若会话有 planId，右栏显示对应规划结果。
11. 新建会话清空当前聊天与结果状态。
12. 删除会话后列表刷新；若删除当前会话，回到空状态。
13. 刷新页面后，会话列表仍在（数据持久化到 DB）。
14. 原有结构化 API 调用方式不受影响（向后兼容，conversationId 可选）。
15. 原有修订（revise）功能不受影响。
16. 无新增 npm 依赖。

## 禁止清单

1. ❌ 禁止改动 flight/hotel/activities/budgeting 4 个业务子 Agent 的业务逻辑。
2. ❌ 禁止改动 supervisor 汇总逻辑。
3. ❌ 禁止改动 intent_agent 抽取逻辑。
4. ❌ 禁止改动 4 个业务子 Agent 之间的拓扑顺序。
5. ❌ 禁止引入任何新依赖。
6. ❌ 禁止改动缓存键规则与 TTL。
7. ❌ 禁止改动 docker-compose.yml、Dockerfile、nginx.conf。
8. ❌ 禁止删除 PlanResult.tsx、ExecutionProgress.tsx、ChatPanel.tsx。
9. ❌ 禁止改动现有修订（revise）功能。
10. ❌ 禁止改动 /plans 历史记录页（PlansPage 保留）。
11. ❌ 禁止改动用户认证逻辑。

## 工作流强制规则

1. 增量开发顺序：
   1. 修改 `schema.prisma`：新增 Conversation、ConversationMessage 模型，User 增加 conversations
   2. 执行 `prisma db push` 更新数据库
   3. 修改 `travel.ts`：TravelRequest 新增 conversationId
   4. 新增 `conversationService.ts`
   5. 修改 `dbService.ts`：SavePlanMeta 增加 conversationId
   6. 修改 `travelService.ts`：generatePlan/generatePlanStream 集成会话持久化
   7. 新增 `routes/conversations.ts`，修改 `index.ts` 注册路由
   8. 修改 `plan.ts`/`planStream.ts`：透传 conversationId
   9. 前端：修改 `client.ts` 新增会话 API
   10. 前端：新增 `SessionList.tsx`
   11. 前端：修改 `PlanPage.tsx` 三栏布局 + 会话切换
   12. 验证：新建会话 → 追问 → 生成规划 → 刷新恢复 → 切换/删除会话
2. 优先验证后端 API（会话 CRUD + 规划持久化），再验证前端三栏交互。
3. 必须验证：刷新页面后会话列表与消息历史仍存在。
4. 必须验证：切换会话能正确恢复追问状态（pendingFields）和规划结果。
5. 任何超出本 Spec 范围的改动，停止开发，等待确认。
