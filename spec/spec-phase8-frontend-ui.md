# spec-phase8-frontend-ui.md

## 阶段前提

1. Phase7 完成：Redis 缓存层就绪，`POST /api/plan`、`GET /api/plans`、`GET /api/plans/:id` 三个接口均可稳定调用，带缓存与降级。
2. 本阶段**不改动多 Agent 架构**（1 主控 + 4 子 Agent）、**不修改 LangGraph 工作流图结构**。
3. 本阶段**不修改**后端 API 的请求/响应格式、不修改数据库 Schema、不修改缓存策略。
4. 本阶段仅在 `apps/web` 下实现前端 UI，调用已有后端接口。

## 阶段目标

基于 **React + Vite + shadcn/ui + Tailwind CSS 4** 构建旅行规划助手的前端界面，实现：

1. **规划表单页**：用户输入旅行需求（目的地、天数、出行日期、预算、偏好、风格），选择运行模式（mock/llm），提交后展示完整规划结果（机票、酒店、每日行程、预算汇总）。
2. **历史列表页**：展示历史规划记录列表，支持分页与按目的地过滤。
3. **规划详情页**：展示单条历史规划的完整内容。

**核心原则：只做前端 UI，不改后端逻辑；前端仅消费已有 API，不新增后端接口。**

## 技术栈与依赖版本锁定

> 所有版本均通过 `npm view` 实时查询确认（查询日期：2026-09-08）。

### 本阶段新增依赖（apps/web）

| 包 | 版本 | 用途 |
|---|---|---|
| react | ^19.2.8 | UI 框架 |
| react-dom | ^19.2.8 | React DOM 渲染 |
| vite | ^8.2.2 | 构建工具 |
| @vitejs/plugin-react | ^6.1.1 | Vite React 插件 |
| react-router-dom | ^7.18.3 | 客户端路由 |
| lucide-react | ^1.42.0 | 图标库 |
| tailwindcss | ^4.3.3 | CSS 框架 |
| @tailwindcss/vite | ^4.3.3 | Tailwind Vite 插件（Tailwind 4 必需） |
| tailwindcss-animate | ^1.0.7 | 动画工具类 |
| class-variance-authority | ^0.7.1 | 组件变体管理 |
| clsx | ^2.1.1 | className 条件拼接 |
| tailwind-merge | ^3.6.0 | Tailwind 类名合并去重 |
| @radix-ui/react-dialog | ^1.1.23 | 对话框原语（shadcn Dialog 依赖） |
| @radix-ui/react-select | ^2.3.7 | 下拉选择原语（shadcn Select 依赖） |
| @radix-ui/react-slot | ^1.3.3 | Slot 原语（shadcn Button 依赖） |
| @radix-ui/react-tabs | ^1.1.21 | 标签页原语（shadcn Tabs 依赖） |

### devDependencies（apps/web）

| 包 | 版本 | 用途 |
|---|---|---|
| @types/react | ^19.2.18 | React 类型 |
| @types/react-dom | ^19.2.7 | React DOM 类型 |
| typescript | ^7.0.2 | TypeScript（沿用根版本） |
| shadcn | ^4.21.0 | shadcn/ui CLI（仅用于初始化与组件添加，运行时不依赖） |

### 复用已有 workspace 包

| 包 | 用途 |
|---|---|
| @travel/shared | 提供 `TravelRequest`、`TravelState`、`FlightResult`、`HotelResult`、`ActivitiesResult`、`BudgetResult` 等类型 |

> 前端通过 `import type { TravelRequest } from '@travel/shared'` 复用类型，保证前后端类型一致。

### 不新增的依赖

- ❌ 不引入 axios（用原生 `fetch`）
- ❌ 不引入状态管理库（React Context + useState 足够）
- ❌ 不引入数据请求库（react-query/swr，用 useEffect + fetch）
- ❌ 不引入 Markdown 渲染库（直接渲染 summary 纯文本或简单格式化）
- ❌ 不引入图表库（预算用列表展示）
- ❌ 不引入表单校验库（简单字段校验，错误由后端返回）

## 前端页面与路由设计

使用 `react-router-dom` 配置 3 个路由：

| 路径 | 页面 | 说明 |
|---|---|---|
| `/` | PlanPage（规划页） | 表单 + 结果展示 |
| `/plans` | PlansPage（历史列表页） | 分页列表 + 目的地过滤 |
| `/plans/:id` | PlanDetailPage（详情页） | 单条规划完整内容 |

### 公共布局（Layout）

- 顶部导航栏：Logo「旅行规划助手」+ 导航链接（「新建规划」「历史记录」）
- 主体内容区由 `<Outlet />` 渲染

## 目标目录结构

```
apps/web/
├── package.json                     # 修改：添加依赖与脚本
├── tsconfig.json                    # 修改：适配 JSX 与 Vite
├── vite.config.ts                   # 新增：Vite 配置（React + Tailwind 4 插件）
├── index.html                       # 新增：HTML 入口
├── postcss.config.js                # 新增：Tailwind PostCSS 配置（Tailwind 4）
├── src/
│   ├── main.tsx                     # 新增：React 入口
│   ├── App.tsx                      # 新增：路由配置 + Layout
│   ├── index.css                    # 新增：Tailwind 指令 + 全局样式
│   ├── lib/
│   │   └── utils.ts                 # 新增：cn() 工具函数（clsx + tailwind-merge）
│   ├── components/
│   │   ├── ui/                      # shadcn 组件（通过 CLI 生成）
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── input.tsx
│   │   │   ├── label.tsx
│   │   │   ├── select.tsx
│   │   │   ├── tabs.tsx
│   │   │   ├── textarea.tsx
│   │   │   └── ...                  # 根据需要通过 shadcn add 添加
│   │   ├── Layout.tsx               # 新增：导航栏 + 内容区布局
│   │   ├── PlanForm.tsx             # 新增：规划表单组件
│   │   ├── PlanResult.tsx           # 新增：规划结果展示组件
│   │   └── PlanCard.tsx             # 新增：历史列表卡片组件
│   ├── pages/
│   │   ├── PlanPage.tsx             # 新增：规划页
│   │   ├── PlansPage.tsx            # 新增：历史列表页
│   │   └── PlanDetailPage.tsx       # 新增：详情页
│   └── api/
│       └── client.ts                # 新增：API 请求封装
└── components.json                  # 新增：shadcn 配置
```

## shadcn/ui 初始化

### 1. 安装 CLI 并初始化

```bash
# 在 apps/web 目录下
pnpm dlx shadcn@latest init
```

初始化时选择：
- Style: `default`
- Base color: `slate`
- CSS variables: `yes`
- Tailwind config: 使用 `tailwind.config.ts`（若 CLI 要求，否则跳过，Tailwind 4 无需此文件）
- `components.json` 路径：`apps/web/components.json`

### 2. 添加需要的组件

```bash
pnpm dlx shadcn@latest add button card input label select tabs textarea
```

> 实际添加的组件以页面需要为准，按需添加，禁止一次性添加全部组件。

### 3. components.json 配置

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/index.css",
    "baseColor": "slate",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

> `rsc: false` 表示不使用 React Server Components（纯 Vite SPA）。

## Tailwind CSS 4 配置

### vite.config.ts

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
```

> Vite dev server 代理 `/api` 到后端 `http://localhost:3000`，避免跨域问题。

### src/index.css

```css
@import "tailwindcss";

@theme {
  --color-background: oklch(1 0 0);
  --color-foreground: oklch(0.145 0 0);
  --color-card: oklch(1 0 0);
  --color-card-foreground: oklch(0.145 0 0);
  --color-popover: oklch(1 0 0);
  --color-popover-foreground: oklch(0.145 0 0);
  --color-primary: oklch(0.205 0 0);
  --color-primary-foreground: oklch(0.985 0 0);
  --color-secondary: oklch(0.97 0 0);
  --color-secondary-foreground: oklch(0.205 0 0);
  --color-muted: oklch(0.97 0 0);
  --color-muted-foreground: oklch(0.556 0 0);
  --color-accent: oklch(0.97 0 0);
  --color-accent-foreground: oklch(0.205 0 0);
  --color-destructive: oklch(0.577 0.245 27.325);
  --color-destructive-foreground: oklch(0.985 0 0);
  --color-border: oklch(0.922 0 0);
  --color-input: oklch(0.922 0 0);
  --color-ring: oklch(0.708 0 0);
  --radius: 0.5rem;
}

body {
  background-color: var(--color-background);
  color: var(--color-foreground);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}
```

> Tailwind 4 使用 `@import "tailwindcss"` + `@theme` 定义 CSS 变量，不再需要 `tailwind.config.js`。

### postcss.config.js

```javascript
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
```

## tsconfig.json（apps/web）

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": ".",
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    },
    "noEmit": true
  },
  "include": ["src/**/*", "vite.config.ts"],
  "exclude": ["node_modules", "dist"]
}
```

> `noEmit: true` 表示 tsc 仅做类型检查，构建由 Vite 负责。
> `jsx: react-jsx` 使用 React 17+ 的新 JSX 转换，无需 import React。

## lib/utils.ts

```typescript
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

## API 请求封装（src/api/client.ts）

封装对后端三个接口的调用，统一处理请求参数与响应解析。

### 类型定义

复用 `@travel/shared` 的类型，并补充 API 响应类型：

```typescript
import type { TravelRequest, TravelState } from '@travel/shared';

export type RunMode = 'mock' | 'llm';

export interface PlanMeta {
  id: string;
  createdAt: string;
}

export type JsonPlanResponse = TravelState & PlanMeta;

export interface PlanListItem {
  id: string;
  destination: string;
  days: number;
  travelDate: string;
  budgetLimit: number | null;
  mode: string;
  summary: string | null;
  createdAt: string;
}

export interface PlanListResponse {
  items: PlanListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export type PlanDetail = TravelState & PlanMeta & {
  userPreference: string | null;
  budgetLimit: number | null;
  travelStyle: string | null;
  mode: string;
  updatedAt: string;
};
```

### API 方法

```typescript
/** 生成规划 */
export async function generatePlan(
  request: TravelRequest,
  mode: RunMode,
): Promise<JsonPlanResponse>

/** 查询历史列表 */
export async function listPlans(
  page: number,
  pageSize: number,
  destination?: string,
): Promise<PlanListResponse>

/** 查询规划详情 */
export async function getPlanById(id: string): Promise<PlanDetail>
```

### 实现要点

- 基础路径：`/api`（Vite 代理到后端）
- `generatePlan`：`POST /api/plan?mode={mode}&format=json`，body 为 `TravelRequest` JSON
- `listPlans`：`GET /api/plans?page={page}&pageSize={pageSize}&destination={destination}`
- `getPlanById`：`GET /api/plans/{id}`
- 请求失败时抛出 Error，由调用方 try/catch 处理
- 不做全局请求拦截器，保持简单

## 页面详细设计

### 1. 规划页（PlanPage）

**布局**：左右分栏（大屏）/ 上下布局（小屏）

**左侧：规划表单（PlanForm）**

| 字段 | 控件 | 必填 | 说明 |
|---|---|---|---|
| destination | Input | 是 | 目的地 |
| days | Input (number) | 是 | 出行天数（>0） |
| travelDate | Input (date) | 是 | 出行日期 |
| budget_limit | Input (number) | 否 | 预算上限（>0） |
| user_preference | Input | 否 | 用户偏好 |
| travel_style | Select | 否 | 出行风格：穷游/舒适/轻奢 |
| mode | Select | 是 | 运行模式：mock/llm（默认 mock） |

**提交行为**：
- 校验必填字段，前端校验失败时在表单下方显示错误提示
- 提交时按钮显示 loading 状态，禁止重复提交
- 调用 `generatePlan`，成功后将结果传给 `PlanResult` 组件展示
- 失败时显示错误提示（后端返回的 error 字段）

**右侧：规划结果（PlanResult）**

使用 Tabs 分 5 个区域展示：
- 概览：目的地、日期、天数、风格、偏好、预算上限、总预算、超支状态
- 机票方案：表格展示航班选项
- 酒店方案：表格展示酒店选项
- 每日行程：按天分组展示活动
- 预算汇总：费用明细表 + 总预算 + 告警/建议

> 初始状态显示占位提示「请填写左侧表单并提交以生成规划」。

### 2. 历史列表页（PlansPage）

**布局**：

- 顶部：目的地过滤输入框 + 搜索按钮
- 中部：规划卡片列表（PlanCard）
- 底部：分页控件（上一页/下一页 + 页码信息）

**PlanCard 展示内容**：
- 目的地 + 天数（大标题）
- 出行日期
- 预算上限（若有）
- 运行模式标签（mock/llm，不同颜色）
- summary 摘要（截取前 100 字）
- 创建时间
- 「查看详情」按钮 → 跳转 `/plans/:id`

**分页**：
- 默认 page=1, pageSize=10
- 显示「第 X 页 / 共 Y 条」
- 第一页禁用「上一页」，最后一页禁用「下一页」

### 3. 详情页（PlanDetailPage）

**布局**：与 PlanResult 结构一致，展示完整规划内容：
- 顶部：返回按钮 + 目的地标题 + 创建时间
- 概览信息
- 机票方案表格
- 酒店方案表格
- 每日行程
- 预算汇总

**加载状态**：显示 loading 占位
**错误状态**：id 不存在时显示「规划记录不存在」提示

## scripts（apps/web/package.json）

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  }
}
```

根 `package.json` 新增脚本：
- `dev:web`：`pnpm --filter @travel/web dev`
- `build:web`：`pnpm --filter @travel/web build`

## 环境变量

前端不需要新增环境变量。API 基础路径通过 Vite dev server 代理 `/api` → `http://localhost:3000` 实现。

生产部署时，若前后端不同源，可通过 `VITE_API_BASE_URL` 环境变量覆盖（本阶段不实现生产部署，仅预留）。

## ✅ 本阶段交付标准

1. `pnpm install` 成功，所有前端依赖安装至 `apps/web`。
2. `pnpm --filter @travel/web dev` 启动 Vite dev server（端口 5173），无报错。
3. `pnpm --filter @travel/web build` 构建成功（tsc 类型检查通过 + vite build 产出 dist）。
4. 规划页：填写表单（mock 模式）提交后，右侧展示完整规划结果（机票、酒店、行程、预算）。
5. 规划页：提交时按钮 loading，结果返回后可再次提交。
6. 规划页：必填字段校验，未填写时显示错误提示，不发请求。
7. 规划页：llm 模式可正常调用（需配置 DOUBAO_API_KEY）。
8. 历史列表页：展示历史规划卡片列表，支持分页与目的地过滤。
9. 详情页：点击列表卡片的「查看详情」跳转后展示完整规划内容。
10. 导航栏可在三个页面间切换。
11. 后端未启动时，前端请求失败显示友好错误提示，不白屏崩溃。
12. 后端 API 零改动，Agent 调度逻辑零改动，数据库 Schema 零改动，缓存策略零改动。

## ❌ Phase8 禁止清单

1. ❌ 禁止新增/删减 Agent 角色，禁止修改 LangGraph 调度流程图。
2. ❌ 禁止修改后端 API 的请求/响应格式（前端仅消费已有接口）。
3. ❌ 禁止修改数据库 Schema、Prisma 模型。
4. ❌ 禁止修改缓存策略、Redis 配置。
4. ❌ 禁止引入 axios、react-query、zustand、redux 等额外运行时库。
5. ❌ 禁止引入用户体系、认证、登录功能。
6. ❌ 禁止新增后端接口（前端仅调用已有 3 个接口）。
7. ❌ 禁止添加图表、地图、图片等复杂可视化（用表格/列表展示）。
8. ❌ 禁止实现规划结果的编辑、删除、导出功能（本阶段只读展示）。
9. ❌ 禁止实现 SSR/SSG（纯 SPA）。
10. ❌ 禁止修改根目录的 tsconfig.base.json（web 自有 tsconfig 覆盖即可）。

## 工作流强制规则

1. 增量开发：初始化项目结构 → 配置 Vite/Tailwind/shadcn → 实现 API 封装 → 实现 Layout + 路由 → 实现规划页 → 实现历史列表页 → 实现详情页 → 验证。
2. 优先保证 mock 模式下的完整流程跑通（表单 → 提交 → 展示结果），再验证 llm 模式。
3. 所有组件使用 shadcn/ui 基础组件，不自行编写复杂 UI 控件。
4. 任何超出本 Spec 范围的改动（如加登录、加图表、加后端接口），停止开发，等待确认。
5. 前端请求失败时，必须显示友好错误提示，禁止静默失败。
