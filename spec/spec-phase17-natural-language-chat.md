# spec-phase17-natural-language-chat.md

## 阶段前提

1. Phase0–Phase16 全部完成：多 Agent 规划、多城市、zod 校验、反馈修订、SSE 流式、toolCalls 持久化、用户系统与个性化、Docker 部署均可用。
2. 当前前端为**结构化表单输入**：用户需手动填写 destination/days/travelDate/budget/preference/style 等字段，无自然语言交互能力。
3. 当前 LangGraph 拓扑为 `START → 并行(flight, hotel, activities) → budgeting → supervisor → END`，无意图识别/信息抽取环节。
4. 本阶段目标：前端改为自然语言对话输入，后端新增 `intent_agent` 前置节点，由 Agent 自主从自然语言中提取旅行需求关键字段，生成规划方案。
5. AGENTS.md 已更新：允许新增「意图识别/信息抽取」类前置节点，不改变 4 个业务子 Agent 的职责与拓扑顺序。
6. 本阶段**不改动 4 个业务子 Agent（flight/hotel/activities/budgeting）的业务逻辑**，**不改动 supervisor 汇总逻辑**。
7. 本阶段**不新增任何 npm 依赖**（mock 模式用正则/关键词规则，llm 模式复用现有豆包 LLM）。

## 阶段目标

实现**自然语言对话式旅行规划**：

1. **前端对话化**：移除结构化表单，改为聊天式输入界面，用户用自然语言描述旅行需求。
2. **意图识别与信息抽取**：LangGraph 新增 `intent_agent` 前置节点，从自然语言中抽取 destination/days/travelDate/budget_limit/user_preference/travel_style/destinations 等结构化字段。
3. **追问机制**：若必填字段（destination/days/travelDate）缺失，intent_agent 返回追问问题，图中断；前端展示追问，用户补充后重新提交。
4. **mock 模式**：用正则/关键词规则抽取字段（零依赖、确定性）。
5. **llm 模式**：调用豆包 LLM（json_object 模式，非 json_schema）抽取字段，输出 JSON 经 zod 校验，解析/校验失败自动重试（最多 2 次），重试耗尽返回空对象触发追问。
6. **向后兼容**：原有结构化 TravelRequest 字段仍保留（前端传递已抽取状态时使用），不破坏现有 API。

## 技术栈与依赖约束

### 新增依赖

无。本阶段复用现有技术栈：
- mock 模式：Node.js 内置正则表达式
- llm 模式：复用 `@travel/llm` 的豆包 LLM 封装
- 校验：复用 Phase13 引入的 zod

### 不新增的依赖

- ❌ 不引入任何 NLP 库（如 node-nlp、compromise）
- ❌ 不引入对话状态管理库
- ❌ 不引入新的前端 UI 库（复用现有 shadcn 组件）

## 目标目录结构

```
packages/shared/src/
├── travel.ts                          # 修改：TravelRequest 新增 naturalLanguage/clarificationHistory；TravelState 新增 needClarification/clarificationQuestion/extractedFields
└── schemas/
    ├── intentExtraction.ts            # 新增：intent 抽取结果 zod schema
    └── index.ts                       # 修改：导出 intentExtraction schema
packages/agents/src/
├── agents/
│   └── intentAgent.ts                 # 新增：意图识别与信息抽取节点
├── graph/
│   └── buildGraph.ts                  # 修改：新增 intent_agent 节点 + 条件边
└── index.ts                           # 修改：导出 intentAgent
apps/api/src/
├── routes/
│   ├── plan.ts                        # 修改：请求体支持 naturalLanguage；响应体支持 needClarification
│   └── planStream.ts                  # 修改：流式支持 clarification 事件
└── services/
    └── travelService.ts               # 修改：处理 needClarification 分支
apps/web/src/
├── components/
│   ├── ChatPanel.tsx                  # 新增：对话面板（消息列表 + 输入框）
│   ├── PlanForm.tsx                   # 删除：结构化表单移除
│   └── PlanResult.tsx                 # 保留：规划结果展示（对话中嵌入）
└── pages/
    └── PlanPage.tsx                   # 修改：改为对话式布局
```

## 核心设计

### 1. 类型扩展（packages/shared/src/travel.ts）

TravelRequest 新增字段：

```typescript
/** 追问消息（Phase17 新增） */
export interface ClarificationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface TravelRequest {
  destination: string;          // 保留
  days: number;                 // 保留
  travelDate: string;           // 保留
  user_preference?: string;     // 保留
  budget_limit?: number;        // 保留
  travel_style?: string;        // 保留
  destinations?: CityDestination[];  // 保留
  // Phase17 新增
  naturalLanguage?: string;              // 用户自然语言输入（最新一轮）
  clarificationHistory?: ClarificationMessage[];  // 对话历史（不含最新输入）
}
```

TravelState 新增字段：

```typescript
export interface TravelState {
  request: TravelRequest;
  flights?: FlightResult;
  hotels?: HotelResult;
  activities?: ActivitiesResult;
  budget?: BudgetResult;
  summary?: string;
  toolCalls?: ToolCallRecord[];
  cityPlans?: CityPlan[];
  // Phase17 新增
  needClarification?: boolean;                    // 是否需要追问
  clarificationQuestion?: string;                  // 追问问题文本
  extractedFields?: Partial<TravelRequest>;        // 已抽取的字段（追问时返回前端）
}
```

> 向后兼容：naturalLanguage / clarificationHistory / needClarification 等均为可选字段，现有结构化请求不受影响。

### 2. 抽取结果校验 schema（packages/shared/src/schemas/intentExtraction.ts）

```typescript
import { z } from 'zod';

/** intent_agent 抽取结果 schema */
export const intentExtractionSchema = z.object({
  destination: z.string().trim().default(''),
  days: z.number().int().positive().default(0),
  travelDate: z.string().trim().default(''),
  budget_limit: z.number().positive().nullable().optional(),
  user_preference: z.string().trim().nullable().optional(),
  travel_style: z.string().trim().nullable().optional(),
  destinations: z
    .array(
      z.object({
        city: z.string().trim().min(1),
        days: z.number().int().positive(),
      }),
    )
    .nullable()
    .optional(),
});

export type IntentExtractionResult = z.infer<typeof intentExtractionSchema>;
```

### 3. intent_agent 节点（packages/agents/src/agents/intentAgent.ts）

```typescript
import type { TravelState, TravelRequest, ClarificationMessage } from '@travel/shared';
import { intentExtractionSchema } from '@travel/shared';
import { isLLMMode, getJSONLLM } from '@travel/llm';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

/** intent 节点系统提示词 */
const INTENT_SYSTEM_PROMPT = `你是旅行规划助手的意图识别与信息抽取模块。
请从用户的自然语言描述中提取旅行规划所需的结构化信息。

需要提取的字段：
- destination: 目的地城市（单个城市时填此字段）
- days: 出行天数（正整数）
- travelDate: 出行日期（YYYY-MM-DD 格式）
- budget_limit: 预算上限（数字，单位元，可选）
- user_preference: 用户偏好（如美食、自然风光、博物馆等，可选）
- travel_style: 出行风格（穷游/舒适/轻奢，可选）
- destinations: 多城市列表（若用户提到多个城市，填此数组，每项含 city 和 days；单城市时不填）

要求：
- 只输出 JSON，不要任何解释或前缀
- 无法确定的字段留空字符串或不填
- 日期统一转为 YYYY-MM-DD 格式
- 若用户提到多个城市，提取到 destinations 数组`;

/**
 * 意图识别与信息抽取节点
 * Phase17 新增
 */
export async function intentAgent(state: TravelState) {
  const { request } = state;
  const naturalLanguage = request.naturalLanguage ?? '';
  const history: ClarificationMessage[] = request.clarificationHistory ?? [];

  // 拼接完整对话上下文
  const fullContext = buildFullContext(naturalLanguage, history);

  // 抽取字段
  const extracted = isLLMMode()
    ? await extractWithLLM(fullContext)
    : extractWithRules(fullContext);

  // 合并：已有字段（前端传递的之前抽取结果）优先级 < 新抽取结果
  const merged: TravelRequest = {
    destination: '',
    days: 0,
    travelDate: '',
    ...extracted,
  };

  // 检查必填字段
  const missing: string[] = [];
  if (!merged.destination) missing.push('目的地');
  if (!merged.days || merged.days <= 0) missing.push('出行天数');
  if (!merged.travelDate) missing.push('出行日期');

  if (missing.length > 0) {
    const question = `请补充以下信息：${missing.join('、')}`;
    return {
      needClarification: true,
      clarificationQuestion: question,
      extractedFields: {
        destination: merged.destination,
        days: merged.days,
        travelDate: merged.travelDate,
        budget_limit: merged.budget_limit,
        user_preference: merged.user_preference,
        travel_style: merged.travel_style,
        destinations: merged.destinations,
      },
      request: merged,
    };
  }

  // 字段完整，继续执行规划
  return {
    needClarification: false,
    request: merged,
  };
}
```

**mock 模式规则抽取函数 `extractWithRules`：**

```typescript
/** 常见城市列表（用于目的地匹配） */
const CITY_LIST = [
  '北京', '上海', '广州', '深圳', '成都', '重庆', '杭州', '南京', '武汉', '西安',
  '长沙', '青岛', '厦门', '苏州', '天津', '郑州', '合肥', '福州', '济南', '沈阳',
  '大连', '宁波', '无锡', '昆明', '贵阳', '南昌', '哈尔滨', '长春', '石家庄', '太原',
  '兰州', '海口', '三亚', '拉萨', '乌鲁木齐', '呼和浩特', '银川', '西宁',
  '东京', '大阪', '京都', '首尔', '釜山', '曼谷', '清迈', '新加坡', '吉隆坡',
  '巴黎', '伦敦', '纽约', '洛杉矶', '旧金山', '悉尼', '墨尔本',
];

function extractWithRules(text: string): Partial<TravelRequest> {
  const result: Partial<TravelRequest> = {};

  // 1. 多城市检测：「A和B」「A到B」「A、B」「A去B」等
  const multiCityPattern = /([\u4e00-\u9fa5A-Za-z]+)(?:和|到|、|去|前往)([\u4e00-\u9fa5A-Za-z]+)/;
  // ... 多城市匹配逻辑

  // 2. 目的地：匹配城市名
  for (const city of CITY_LIST) {
    if (text.includes(city)) {
      result.destination = city;
      break;
    }
  }

  // 3. 天数：「X天」「X日」「玩X天」「X日游」
  const daysMatch = text.match(/(\d+)\s*(?:天|日)/);
  if (daysMatch) {
    result.days = parseInt(daysMatch[1], 10);
  }

  // 4. 日期：「X月X日」「X号」
  const dateMatch = text.match(/(\d{1,2})月(\d{1,2})[日号]?/);
  if (dateMatch) {
    const month = dateMatch[1].padStart(2, '0');
    const day = dateMatch[2].padStart(2, '0');
    // 年份取当前年（简化处理）
    const year = new Date().getFullYear();
    result.travelDate = `${year}-${month}-${day}`;
  }

  // 5. 预算：「预算X」「X元」「X块」
  const budgetMatch = text.match(/(?:预算|花费)?\s*(\d+)\s*(?:元|块)/);
  if (budgetMatch) {
    result.budget_limit = parseInt(budgetMatch[1], 10);
  }

  // 6. 风格：穷游/舒适/轻奢
  if (text.includes('穷游')) result.travel_style = '穷游';
  else if (text.includes('舒适')) result.travel_style = '舒适';
  else if (text.includes('轻奢')) result.travel_style = '轻奢';

  // 7. 偏好：「喜欢XX」「XX控」
  const prefMatch = text.match(/喜欢([\u4e00-\u9fa5A-Za-z、，,\s]+)/);
  if (prefMatch) {
    result.user_preference = prefMatch[1].trim();
  }

  return result;
}
```

> 注：多城市检测逻辑在 `extractWithRules` 中实现，匹配到多个城市时填充 `destinations` 数组，同时 `destination` 取第一个城市。

**llm 模式 LLM 抽取函数 `extractWithLLM`：**

> 采用项目已验证可用的 `json_object` 模式（`getJSONLLM()`），不使用 `json_schema`（豆包不支持）。
> 解析失败或 zod 校验失败时自动重试，重试耗尽后返回空对象（触发追问流程）。

```typescript
/** LLM 抽取最大重试次数 */
const LLM_EXTRACT_MAX_RETRIES = 2;

async function extractWithLLM(text: string): Promise<Partial<TravelRequest>> {
  const llm = getJSONLLM();  // json_object 模式，豆包已验证可用
  if (!llm) {
    console.error('[IntentAgent] LLM 未配置，无法抽取');
    return {};
  }

  const totalAttempts = LLM_EXTRACT_MAX_RETRIES + 1;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    try {
      const response = await llm.invoke([
        new SystemMessage(INTENT_SYSTEM_PROMPT),
        new HumanMessage(text),
      ]);

      const content =
        typeof response.content === 'string' ? response.content : '';

      if (!content) {
        throw new Error('LLM 返回内容为空');
      }

      // 清理可能的 markdown 代码块标记
      const jsonStr = content
        .replace(/```json\s*/g, '')
        .replace(/```/g, '')
        .trim();

      const parsed = JSON.parse(jsonStr) as unknown;

      // zod 校验：字段类型/格式不通过则抛错重试
      const validated = intentExtractionSchema.parse(parsed);

      console.log(
        `[IntentAgent] LLM 抽取成功${attempt > 1 ? `（重试${attempt - 1}次）` : ''}`,
      );
      return validated;
    } catch (err) {
      lastError = err as Error;
      if (attempt < totalAttempts) {
        console.warn(
          `[IntentAgent] LLM 抽取失败（第 ${attempt}/${totalAttempts} 次）：${lastError.message}，重试中...`,
        );
      }
    }
  }

  // 重试耗尽：返回空对象，由必填字段检查触发追问
  console.error(
    `[IntentAgent] LLM 抽取重试 ${LLM_EXTRACT_MAX_RETRIES} 次后仍失败：${lastError?.message ?? '未知错误'}，返回空结果触发追问`,
  );
  return {};
}
```

**对话上下文拼接函数 `buildFullContext`：**

```typescript
function buildFullContext(latest: string, history: ClarificationMessage[]): string {
  if (history.length === 0) return latest;
  const parts = history.map((m) => `${m.role === 'user' ? '用户' : '助手'}：${m.content}`);
  parts.push(`用户：${latest}`);
  return parts.join('\n');
}
```

### 4. LangGraph 拓扑调整（packages/agents/src/graph/buildGraph.ts）

```typescript
import { intentAgent } from '../agents/intentAgent.js';

const StateAnnotation = Annotation.Root({
  request: Annotation<TravelRequest>(),
  flights: Annotation<FlightResult | undefined>(),
  hotels: Annotation<HotelResult | undefined>(),
  activities: Annotation<ActivitiesResult | undefined>(),
  budget: Annotation<BudgetResult | undefined>(),
  summary: Annotation<string | undefined>(),
  toolCalls: Annotation<ToolCallRecord[] | undefined>({
    reducer: (left, right) => [...(left ?? []), ...(right ?? [])],
  }),
  // Phase17 新增
  needClarification: Annotation<boolean | undefined>(),
  clarificationQuestion: Annotation<string | undefined>(),
  extractedFields: Annotation<Partial<TravelRequest> | undefined>(),
});

export function buildTravelGraph() {
  const graph = new StateGraph(StateAnnotation)
    .addNode('intent_agent', intentAgent)
    .addNode('flight_agent', flightAgent)
    .addNode('hotel_agent', hotelAgent)
    .addNode('activities_agent', activitiesAgent)
    .addNode('budgeting_agent', budgetingAgent)
    .addNode('supervisor_agent', supervisorAgent)

    // START → intent_agent
    .addEdge(START, 'intent_agent')

    // intent_agent → 条件路由
    .addConditionalEdges(
      'intent_agent',
      (state: TravelState) => {
        if (state.needClarification) return 'clarify';
        return 'plan';
      },
      {
        clarify: END,
        // plan 分支：并行进入三个子 Agent
        plan: ['flight_agent', 'hotel_agent', 'activities_agent'],
      },
    )

    // 三个子 Agent → budgeting
    .addEdge(['flight_agent', 'hotel_agent', 'activities_agent'], 'budgeting_agent')

    // budgeting → supervisor
    .addEdge('budgeting_agent', 'supervisor_agent')

    // supervisor → END
    .addEdge('supervisor_agent', END);

  return graph.compile();
}
```

> 说明：LangGraph 条件边支持返回数组实现 fan-out（并行路由到多个节点）。`plan` 分支返回三个子 Agent 节点名，实现并行调度；`clarify` 分支直接到 END，图中断。

### 5. 追问机制（前后端协作）

**前端状态维护：**
- `messages: { role: 'user' | 'assistant', content: string }[]` — 对话消息列表
- `pendingExtracted: Partial<TravelRequest>` — 上一轮已抽取的字段

**用户发送消息时：**
1. 将用户消息加入 `messages`
2. 构造请求体：
   ```json
   {
     "naturalLanguage": "用户最新输入",
     "clarificationHistory": [/* 之前的对话历史 */],
     ...pendingExtracted  // 带上之前已抽取的字段
   }
   ```
3. 调用 `POST /api/plan/stream`
4. 若返回 `needClarification: true`：
   - 将 `clarificationQuestion` 作为 assistant 消息加入 `messages`
   - 更新 `pendingExtracted = extractedFields`
   - 等待用户补充
5. 若返回完整规划结果：
   - 在消息流中嵌入 PlanResult 卡片展示
   - 清空 `pendingExtracted`

**后端处理：**
- intent_agent 接收 `naturalLanguage` + `clarificationHistory` + 已抽取字段
- 合并抽取结果（新抽取优先级 > 已有字段）
- 必填字段缺失 → 返回追问，图中断
- 必填字段完整 → 继续规划流程

### 6. 前端改动

**删除** `PlanForm.tsx`（结构化表单移除）。

**新增** `ChatPanel.tsx`：

```
┌─────────────────────────────────────┐
│  消息列表区域（滚动）                  │
│  ┌───────────────────────────────┐  │
│  │ 用户: 我想去成都玩5天            │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ 助手: 请补充以下信息：出行日期    │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ 用户: 10月1日出发，预算8000      │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ [规划结果卡片 PlanResult]       │  │
│  └───────────────────────────────┘  │
├─────────────────────────────────────┤
│  运行模式: [mock ▾]                   │
│  ┌───────────────────────────┐ [发送]│
│  │ 输入旅行需求...              │      │
│  └───────────────────────────┘      │
└─────────────────────────────────────┘
```

- 消息列表：用户消息右对齐，助手消息左对齐
- 规划结果：助手消息中嵌入 PlanResult 组件
- 执行过程：规划生成时展示 ExecutionProgress（复用现有组件）
- 输入框：textarea + 发送按钮，Enter 发送，Shift+Enter 换行
- 运行模式：Select 选择 mock/llm

**PlanPage.tsx 改动：**
- 移除 PlanForm，改为 ChatPanel
- 状态管理：messages、loading、mode、planResult
- 调用 revisePlanStream 等修订功能仍保留（在 PlanResult 中触发）

### 7. API 改动

**POST /api/plan 请求体扩展：**

```json
{
  "naturalLanguage": "我想去成都玩5天，10月1日出发，预算8000，喜欢美食",
  "clarificationHistory": [
    { "role": "user", "content": "我想去成都玩" },
    { "role": "assistant", "content": "请补充以下信息：出行天数、出行日期" }
  ],
  "destination": "",
  "days": 0,
  "travelDate": ""
}
```

> 原有结构化字段仍保留，用于传递前端维护的已抽取状态。

**POST /api/plan 响应（追问场景）：**

```json
{
  "needClarification": true,
  "clarificationQuestion": "请补充以下信息：出行日期",
  "extractedFields": {
    "destination": "成都",
    "days": 5,
    "travelDate": "",
    "budget_limit": 8000,
    "user_preference": "美食",
    "travel_style": null,
    "destinations": null
  },
  "request": {
    "destination": "成都",
    "days": 5,
    "travelDate": "",
    "budget_limit": 8000,
    "user_preference": "美食"
  }
}
```

**POST /api/plan 响应（规划完成场景）：** 与现有格式一致，包含 flights/hotels/activities/budget/summary 等。

**POST /api/plan/stream 流式事件扩展：**

新增 `clarification` 事件类型：

```typescript
export type SSEEvent =
  | { type: 'start'; data: { message: string } }
  | { type: 'node_complete'; data: { node: string; toolCalls?: TravelState['toolCalls'] } }
  | { type: 'cache_hit'; data: { result: TravelState & PersistMeta } }
  | { type: 'complete'; data: { result: TravelState & PersistMeta } }
  | { type: 'clarification'; data: { question: string; extractedFields: Partial<TravelRequest> } }
  | { type: 'error'; data: { message: string } };
```

当 intent_agent 返回 needClarification 时，流式产出 `clarification` 事件后结束，不继续执行后续节点。

### 8. travelService.ts 改动

`generatePlan` 和 `generatePlanStream` 中，图执行后检查 `needClarification`：

```typescript
const result = await app.invoke({ request });

if (result.needClarification) {
  // 追问场景：不持久化、不缓存，直接返回追问信息
  return {
    ...result,
    ...meta,  // meta 为空（未持久化）
  };
}

// 正常规划流程：缓存 + 持久化
await cacheSet(cacheKey, result, PLAN_RESULT_TTL[mode]);
const meta = await persistPlan(result, mode, persistMeta);
```

流式版本中，intent_agent 完成后若 needClarification，yield `clarification` 事件并 return。

## API 响应格式

### POST /api/plan

**请求体：**
```json
{
  "naturalLanguage": "国庆去成都和重庆玩，一共6天，预算1万",
  "clarificationHistory": []
}
```

**响应（追问，200）：**
```json
{
  "needClarification": true,
  "clarificationQuestion": "请补充以下信息：出行日期",
  "extractedFields": {
    "destination": "成都",
    "days": 6,
    "travelDate": "",
    "budget_limit": 10000,
    "destinations": [
      { "city": "成都", "days": 3 },
      { "city": "重庆", "days": 3 }
    ]
  }
}
```

**响应（规划完成，200）：** 与现有格式一致。

### POST /api/plan/stream

SSE 流事件：
- 追问场景：`clarification` 事件后结束
- 规划场景：`start` → `node_complete` × N → `complete`

## 缓存兼容性

- 追问场景（needClarification）不写入缓存、不持久化到 DB
- 规划完成场景的缓存键 `planResultKey(request, mode)` 不变
- `naturalLanguage` 和 `clarificationHistory` 不参与缓存键计算（缓存键基于结构化字段）

## 交付标准

1. `pnpm build` 成功，无 TypeScript 错误。
2. LangGraph 拓扑新增 `intent_agent` 节点，条件路由正确（追问 → END，否则 → 并行子 Agent）。
3. mock 模式下，自然语言「我想去成都玩5天，10月1日出发，预算8000」能正确抽取 destination=成都、days=5、travelDate=当年-10-01、budget_limit=8000。
4. mock 模式下，缺少必填字段时返回 needClarification=true 和追问问题。
5. llm 模式下，使用 `getJSONLLM()`（json_object 模式，非 json_schema）从自然语言抽取结构化字段，输出经 zod 校验。
6. llm 模式下，JSON 解析或 zod 校验失败时自动重试（最多 2 次），重试耗尽后返回空对象触发追问流程，不抛出未捕获异常。
7. 多城市自然语言（如「成都和重庆各玩3天」）能正确抽取 destinations 数组。
8. 前端对话界面可用：用户输入自然语言 → Agent 抽取/追问 → 生成规划 → 展示结果。
9. 追问流程：用户补充信息后能继续生成规划。
10. 原有结构化 API 调用方式不受影响（向后兼容）。
11. 无新增 npm 依赖。

## 禁止清单

1. ❌ 禁止改动 flight/hotel/activities/budgeting 4 个业务子 Agent 的业务逻辑。
2. ❌ 禁止改动 supervisor 汇总逻辑。
3. ❌ 禁止改动 4 个业务子 Agent 之间的拓扑顺序（并行 → budgeting → supervisor）。
4. ❌ 禁止引入任何新依赖。
5. ❌ 禁止改动缓存键规则与 TTL。
6. ❌ 禁止改动 docker-compose.yml、Dockerfile、nginx.conf。
7. ❌ 禁止删除 PlanResult.tsx（规划结果展示仍需复用）。
8. ❌ 禁止改动现有修订（revise）功能。

## 工作流强制规则

1. 增量开发顺序：
   1. 修改 `travel.ts`：新增 ClarificationMessage 类型，扩展 TravelRequest/TravelState
   2. 新增 `schemas/intentExtraction.ts` + 更新 `schemas/index.ts`
   3. 新增 `agents/intentAgent.ts`：mock 规则抽取 + llm 抽取
   4. 修改 `buildGraph.ts`：新增 intent_agent 节点 + 条件边
   5. 修改 `travelService.ts`：处理 needClarification 分支
   6. 修改 `plan.ts` / `planStream.ts`：支持 naturalLanguage 请求 + clarification 响应
   7. 前端：新增 ChatPanel.tsx，删除 PlanForm.tsx，修改 PlanPage.tsx
   8. 验证：mock 抽取 → 追问流程 → 完整规划 → 多城市 → llm 模式
2. 优先验证 mock 模式完整流程，再验证 llm 模式。
3. 必须验证：追问后补充信息能正确合并并生成规划。
4. 必须验证：原有结构化请求仍能正常工作（向后兼容）。
5. 任何超出本 Spec 范围的改动，停止开发，等待确认。
