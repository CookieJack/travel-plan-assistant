# spec-phase16-user-system-personalization.md

## 阶段前提

1. Phase0–Phase15 全部完成：多 Agent 规划、多城市、zod 校验、反馈修订、SSE 流式、toolCalls 持久化、Docker 部署均可用。
2. 当前系统**无任何用户系统**：无 User 模型、无认证、无 session，所有规划匿名存储。
3. 本阶段实现**轻量版用户系统**：注册/登录、规划归属、个性化偏好。
4. **硬约束**：不引入任何新 npm 依赖（认证/密码哈希/Token 全部用 Node.js 内置 `crypto` + Hono 中间件实现）。
5. 不改动 LangGraph 拓扑、不改动 Agent 业务逻辑、不改动工具参数。

## 阶段目标

实现**轻量用户系统与个性化**：

1. **用户注册/登录**：用户名 + 密码，密码用 Node 内置 `crypto.scrypt` 哈希存储（不引 bcrypt）
2. **轻量鉴权**：基于签名 Token 的 Hono 中间件（Token 用 `crypto` HMAC 签名，前端存 localStorage）
3. **规划归属**：TravelPlan 关联 userId，列表/详情只返回当前用户的规划
4. **个性化偏好**：User 表存默认出行风格/预算上限/偏好，生成规划时自动带入，用户可在个人设置页修改
5. **向后兼容**：未登录用户仍可生成规划（匿名规划，userId 为 null）；已登录用户规划关联 userId

## 技术栈与依赖约束

### 新增依赖

**无。** 全部用现有技术栈 + Node.js 内置模块：
- 密码哈希：`crypto.scrypt` + `crypto.randomBytes`（盐）
- Token 签名：`crypto.createHmac('sha256', secret)`
- 鉴权中间件：Hono 原生中间件

### 不新增的依赖

- ❌ 不引入 bcrypt / argon2 / passport / auth.js / jsonwebtoken 等
- ❌ 不引入 session 库

## 目标目录结构

```
apps/api/src/
├── routes/
│   ├── auth.ts                    # 新增：注册/登录/登出/当前用户
│   ├── user.ts                    # 新增：获取/更新用户偏好
│   ├── plan.ts                    # 修改：生成规划时关联 userId
│   ├── planStream.ts              # 修改：流式规划关联 userId
│   └── plans.ts                   # 修改：列表/详情按 userId 过滤
├── middleware/
│   └── auth.ts                    # 新增：Token 解析中间件（可选鉴权）
├── lib/
│   ├── crypto.ts                  # 新增：密码哈希 + Token 签名/验证
│   └── prisma.ts                  # 不变
└── services/
    ├── dbService.ts               # 修改：savePlan 支持 userId；新增用户 CRUD
    └── travelService.ts           # 修改：生成规划时带入用户偏好
apps/api/prisma/
└── schema.prisma                  # 修改：新增 User 模型；TravelPlan 加 userId 字段
apps/web/src/
├── api/
│   └── client.ts                  # 修改：新增 auth/user API + Token 拦截
├── context/
│   └── AuthContext.tsx            # 新增：登录态 Context
├── pages/
│   ├── LoginPage.tsx              # 新增：登录/注册页
│   └── ProfilePage.tsx            # 新增：个人设置（偏好）页
├── components/
│   └── Layout.tsx                 # 修改：顶部导航栏加登录/用户名入口
└── App.tsx                        # 修改：加登录/设置路由
```

## 核心设计

### 1. 数据模型（schema.prisma）

```prisma
model User {
  id           String   @id @default(cuid())
  username     String   @unique
  passwordHash String
  salt         String
  // 个性化偏好（均可为空，生成规划时自动带入）
  defaultStyle      String?   // 出行风格：穷游/舒适/轻奢
  defaultBudget     Float?    // 默认预算上限
  defaultPreference String?   // 默认偏好（美食/自然风光等）
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  plans TravelPlan[]
}

model TravelPlan {
  ...
  userId    String?  // Phase16 新增：规划归属用户（null 为匿名规划）
  user      User?    @relation(fields: [userId], references: [id])
  ...
  @@index([userId])
}
```

### 2. 密码哈希（lib/crypto.ts）

使用 Node 内置 `crypto.scrypt`，无需外部依赖：

```typescript
import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';

/** 生成盐 + 哈希密码 */
export function hashPassword(password: string): { salt: string; hash: string } {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

/** 验证密码 */
export function verifyPassword(password: string, salt: string, hash: string): boolean {
  const inputHash = scryptSync(password, salt, 64);
  const storedHash = Buffer.from(hash, 'hex');
  return timingSafeEqual(inputHash, storedHash);
}
```

> 注：`scryptSync` / `timingSafeEqual` 均为 Node 内置，零依赖。

### 3. Token 签名（lib/crypto.ts）

用 HMAC-SHA256 签名，不引 jsonwebtoken：

```typescript
const TOKEN_SECRET = process.env.TOKEN_SECRET || 'dev-secret-change-me';
const TOKEN_TTL = 7 * 24 * 60 * 60; // 7 天

/** 生成签名 Token：base64(payload).hmac */
export function signToken(payload: { userId: string }): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + TOKEN_TTL * 1000 })).toString('base64url');
  const sig = createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/** 验证 Token，返回 payload 或 null */
export function verifyToken(token: string): { userId: string } | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
  if (sig !== expected) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (payload.exp < Date.now()) return null;
  return { userId: payload.userId };
}
```

### 4. 鉴权中间件（middleware/auth.ts）

**可选鉴权**：未登录请求也能通过（userId 为 undefined），已登录请求解析出 userId：

```typescript
import type { MiddlewareHandler } from 'hono';

declare module 'hono' {
  interface ContextVariableMap {
    userId?: string;
  }
}

/** 可选鉴权：解析 Authorization header，未登录也放行 */
export const optionalAuth: MiddlewareHandler = async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const payload = verifyToken(token);
    if (payload) {
      c.set('userId', payload.userId);
    }
  }
  await next();
};
```

- 规划生成接口用 `optionalAuth`（登录则关联，未登录则匿名）
- 列表/详情接口后续可加强制鉴权（本阶段先保持可选，保证向后兼容）

### 5. 规划归属（travelService.ts / dbService.ts）

- `generatePlan` 接收可选 `userId` 参数
- 若有 userId，规划结果关联该用户；否则 userId 为 null（匿名）
- `savePlan` 写入 `userId`
- `listPlans` 支持按 `userId` 过滤（有 userId 只返回该用户的，无 userId 返回全部匿名 + 该用户的——本阶段简化为：传了 userId 就过滤）

### 6. 个性化偏好带入（travelService.ts）

生成规划时，若用户已登录且有默认偏好，自动填充到 request（用户显式传入的优先级更高）：

```typescript
function applyUserPreferences(request, user) {
  if (user?.defaultStyle && !request.travel_style) {
    request.travel_style = user.defaultStyle;
  }
  if (user?.defaultBudget != null && request.budget_limit == null) {
    request.budget_limit = user.defaultBudget;
  }
  if (user?.defaultPreference && !request.user_preference) {
    request.user_preference = user.defaultPreference;
  }
}
```

### 7. 前端鉴权（AuthContext）

```typescript
// context/AuthContext.tsx
interface AuthState {
  user: { id: string; username: string } | null;
  login: (username, password) => Promise<void>;
  register: (username, password) => Promise<void>;
  logout: () => void;
}
```

- Token 存 localStorage，请求时自动带 `Authorization: Bearer <token>` header
- 页面刷新时从 localStorage 恢复登录态（调用 `/api/auth/me` 验证）
- 未登录可浏览，但生成的规划为匿名

## API 设计

### 认证接口

**POST /api/auth/register**
```json
// 请求
{ "username": "alice", "password": "123456" }
// 响应
{ "token": "...", "user": { "id": "...", "username": "alice" } }
```

**POST /api/auth/login**
```json
// 请求
{ "username": "alice", "password": "123456" }
// 响应 200
{ "token": "...", "user": { "id": "...", "username": "alice" } }
// 响应 401
{ "error": "用户名或密码错误", "code": "AUTH_ERROR" }
```

**GET /api/auth/me** （需 Bearer Token）
```json
// 响应
{ "id": "...", "username": "alice", "defaultStyle": "舒适", "defaultBudget": 8000, "defaultPreference": "美食" }
```

### 用户偏好接口

**GET /api/user/preferences** （需登录）
```json
{ "defaultStyle": "舒适", "defaultBudget": 8000, "defaultPreference": "美食" }
```

**PUT /api/user/preferences** （需登录）
```json
// 请求
{ "defaultStyle": "穷游", "defaultBudget": 5000, "defaultPreference": "自然风光" }
// 响应
{ "defaultStyle": "穷游", "defaultBudget": 5000, "defaultPreference": "自然风光" }
```

### 规划接口改动

**POST /api/plan** & **POST /api/plan/stream**：
- 请求头可选 `Authorization: Bearer <token>`
- 有 token 则规划关联 userId，并自动带入用户默认偏好
- 无 token 则匿名规划（现有行为不变）

**GET /api/plans**：
- 有 token 则只返回该用户的规划
- 无 token 则返回匿名规划（向后兼容）

## 交付标准

1. `pnpm build` 成功，无 TypeScript 错误。
2. `prisma db push` 成功，新增 User 表 + TravelPlan.userId 字段。
3. 用户注册成功，密码以 scrypt 哈希存储（不存明文）。
4. 用户登录成功返回 Token，错误密码返回 401。
5. Token 验证正确，伪造 Token 被拒绝。
6. 已登录用户生成规划，规划记录 userId 正确关联。
7. 已登录用户列表只返回自己的规划。
8. 未登录用户仍可生成规划（匿名，userId 为 null）。
9. 用户默认偏好设置后，生成规划时自动带入（用户显式传参优先级更高）。
10. 前端登录页可用，登录后顶部显示用户名，登出后回到匿名状态。
11. 前端个人设置页可修改默认偏好。
12. 无新增 npm 依赖。

## 禁止清单

1. ❌ 禁止引入 bcrypt / argon2 / passport / auth.js / jsonwebtoken 等任何认证相关依赖。
2. ❌ 禁止改动 LangGraph 拓扑与 Agent 业务逻辑。
3. ❌ 禁止改动工具参数。
4. ❌ 禁止改动现有规划生成流程（仅增加 userId 关联与偏好带入）。
5. ❌ 禁止改动 docker-compose.yml / Dockerfile / nginx.conf。
6. ❌ 禁止删除或重构现有路由（仅扩展）。

## 工作流强制规则

1. 增量开发顺序：
   1. 修改 `schema.prisma`：新增 User 模型 + TravelPlan.userId 字段 → prisma db push
   2. 新增 `lib/crypto.ts`：密码哈希 + Token 签名/验证
   3. 新增 `middleware/auth.ts`：可选鉴权中间件
   4. 修改 `dbService.ts`：新增用户 CRUD + savePlan 支持 userId
   5. 新增 `routes/auth.ts`：注册/登录/me
   6. 新增 `routes/user.ts`：偏好读写
   7. 修改 `routes/plan.ts` / `planStream.ts`：应用 optionalAuth + 传入 userId
   8. 修改 `routes/plans.ts`：列表按 userId 过滤
   9. 修改 `travelService.ts`：偏好带入
   10. 修改 `index.ts`：注册新路由 + 应用中间件
   11. 前端：AuthContext + LoginPage + ProfilePage + Layout + App 路由 + client.ts
   12. 验证：注册→登录→生成规划（关联）→列表过滤→偏好带入→登出
2. 优先验证匿名规划不受影响（向后兼容），再验证登录用户流程。
3. 必须验证：密码不存明文、Token 伪造被拒。
4. 任何超出本 Spec 范围的改动，停止开发，等待确认。
