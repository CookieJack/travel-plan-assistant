# spec-phase3-structured-output.md

## 阶段前提

1. Phase2 代码完整可用：`--mode mock` 与 `--mode llm` 两条链路均跑通，5 个 Agent 角色与 LangGraph 工作流拓扑稳定。
2. 项目根目录 `.env` 已配置豆包 API 密钥（Phase2 遗留，本阶段不改动密钥逻辑）。
3. 本阶段**不改动多 Agent 架构**（1 主控 + 4 子 Agent 数量不变）、**不修改 LangGraph 工作流图结构**（START → 并行(f/h/a) → budgeting → supervisor → END）。
4. 不做 Web 页面、不做 HTTP 接口服务、不接真实机票/酒店第三方业务 API、不做数据库持久化。

## 阶段目标

在 Phase2 已有「真实 LLM + mock 兜底」基础上，补齐两个短板：

1. **LLM 结构化输出健壮性**：当前 `callLLMJson` 直接 `JSON.parse`，LLM 一旦返回非合法 JSON 或字段缺失/类型错误，就静默回退 mock，用户无法感知也没有重试。本阶段为每个 Agent 的 LLM 输出增加 **JSON Schema 校验 + 有限重试 + 最终 mock 兜底**，并在日志中标注每个 Agent 实际使用的生成模式。
2. **旅行方案导出**：当前最终方案只打印到终端 stdout。本阶段增加 `--output <文件>` 与 `--format text|json|markdown` 选项，支持把最终方案落盘为文件，便于留存与分享。

> 本阶段定位：**质量加固 + 输出能力补全**，不新增业务功能、不扩展 Agent 能力边界。

## 技术栈与依赖约束

1. 沿用 Phase0–Phase2 锁定的全部依赖版本，**不升级主版本、不新增任何 npm 包**。
2. JSON 校验采用**零依赖手写 TypeScript 类型守卫（type guard）**，不引入 zod / ajv 等第三方校验库。
3. 文件写入使用 Node.js 内置 `node:fs/promises`，不引入文件操作第三方库。
4. `.env` 密钥管理逻辑保持不变。

## 需要修改实现范围（增量修改，禁止删除 phase2 有效代码）

### 1. 新增 LLM 输出校验层 `src/llm.ts`（扩展，不重写）

在现有 `callLLMJson` 基础上扩展，**不破坏现有签名**，新增可选参数：

```ts
export async function callLLMJson<T = unknown>(
  systemPrompt: string,
  userContent: string,
  validate?: (data: unknown) => data is T,   // 新增：类型守卫
  maxRetries = 2,                              // 新增：重试次数
): Promise<T>
```

行为规则：
- 调用 LLM → `JSON.parse` → 若提供了 `validate` 则校验。
- 解析失败或校验失败：重试（重新调用 LLM，最多 `maxRetries` 次）。
- 重试全部耗尽：抛出错误，由调用方决定是否回退 mock。
- 控制台打印 `[AgentName] 使用模式：llm(校验通过) / llm(重试x次后通过) / mock(LLM失败兜底)`，便于调试感知。

> 现有未传 `validate` 的调用行为保持不变（直接 parse 返回），保证 Phase2 兼容。

### 2. 为 4 个子 Agent + Supervisor 补类型守卫

在 `src/types/travel.ts` 同级或各 Agent 文件内，新增轻量校验函数：

- `isFlightResult(data): data is { options: FlightOption[] }`
- `isHotelResult(data): data is { options: HotelOption[] }`
- `isActivitiesResult(data): data is { itinerary: DayItinerary[] }`
- `isBudgetResult(data): data is BudgetResult`（含 total/breakdown/overBudget 等字段类型校验）

校验粒度：字段存在性 + 基础类型（number/string/array），不做业务规则校验（如价格范围），保持轻量。

各 Agent 的 `callLLMJson` 调用传入对应 `validate`，并把重试耗尽后的 catch 回退逻辑保持为现有 mock 兜底。

### 3. 旅行方案导出 `src/output/formatter.ts`（扩展）

在现有 `formatPlan(state): string`（纯文本）基础上，新增两个导出函数，**不修改原函数**：

- `formatPlanMarkdown(state): string`：Markdown 格式方案，结构与文本版一致，使用 `#`/`##`/`-`/表格等 Markdown 语法。
- `formatPlanJson(state): string`：将 `state` 中已生成的结构化结果（request + flights + hotels + activities + budget）序列化为格式化 JSON 字符串（不含内部 `summary` 文本字段，或可含，由 spec 决定——本阶段定为**包含 summary**）。

### 4. CLI 入口增强 `src/main.ts`

新增命令行选项解析（与现有 `--mode` 同级，向后兼容）：

- `--output <path>`：将最终方案写入指定文件，同时仍在 stdout 打印。
- `--format text|markdown|json`：选择输出格式，默认 `text`。未指定 `--output` 时，仅 stdout 输出对应格式；指定 `--output` 时，按格式写入文件。
- `--mode mock|llm`：保持不变。

非法格式值给出明确错误提示。

文件写入：使用 `node:fs/promises.writeFile`，写入前若目标目录不存在**不自动创建**（保持最小行为，直接抛错提示用户），若文件已存在则覆盖。

## ✅ 本阶段交付标准

1. Phase2 原有 `mock` / `llm` 模式全部功能保留可用，输入参数与输出格式不变。
2. LLM 模式下，每个 Agent 的输出都经过类型守卫校验；非法输出会触发重试（最多 2 次），重试失败后回退 mock，并在控制台打印每个 Agent 的实际模式。
3. `--format markdown` 输出结构清晰的 Markdown 方案文本。
4. `--format json` 输出包含 request/flights/hotels/activities/budget/summary 的结构化 JSON。
5. `--output <path>` 能把方案按指定格式写入文件，stdout 同步输出。
6. 全程内存运行，无数据库、无 Web 服务、无真实业务 API 调用。

## ❌ Phase3【禁止清单】

1. ❌ 禁止新增/删减 Agent 角色，禁止修改 LangGraph 调度流程图与节点拓扑。
2. ❌ 禁止接入真实机票、酒店、旅游第三方业务 API，业务数据依旧由 LLM/mock 生成。
3. ❌ 禁止开发 Web UI、HTTP 后端接口服务。
4. ❌ 禁止数据库、持久化存储旅行方案到数据库（仅允许本阶段定义的单文件导出）。
5. ❌ 禁止新增 npm 依赖包（校验用手写类型守卫，文件操作用 node:fs）。
6. ❌ 禁止大规模重构 phase0–phase2 已稳定的 graph、state、Agent 内部业务逻辑，只做增量修改。
7. ❌ 禁止把 LLM 校验失败时的 mock 兜底逻辑删除（兜底必须保留）。
8. ❌ 禁止修改 `.env` 密钥读取方式，禁止硬编码密钥。

## 工作流强制规则

1. 增量开发，原有 mock 逻辑与 formatter 全部保留，不删除不重写。
2. 优先保证 `mock` 模式与默认 `text` 格式依旧正常跑通，再调试 LLM 校验重试与新格式。
3. 任何想超出本 Spec 范围的改动（如流式输出、多轮对话、Web 化、新 Agent），停止开发，等待确认。
