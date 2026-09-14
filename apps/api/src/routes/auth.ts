/**
 * Phase16 新增：认证路由
 * POST /api/auth/register  - 注册
 * POST /api/auth/login     - 登录
 * GET  /api/auth/me        - 当前用户信息（需 Bearer Token）
 */
import { Hono } from 'hono';
import { z } from '@travel/shared';
import { hashPassword, verifyPassword, signToken } from '../lib/crypto.js';
import {
  createUser,
  getUserByUsername,
  getUserById,
} from '../services/dbService.js';
import { optionalAuth } from '../middleware/auth.js';

const auth = new Hono();

/** 注册/登录请求体校验 */
const credentialsSchema = z.object({
  username: z.string().trim().min(1, '用户名不能为空').max(50, '用户名最长 50 字符'),
  password: z.string().min(6, '密码至少 6 位').max(100, '密码最长 100 字符'),
});

// POST /api/auth/register
auth.post('/register', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = credentialsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? '参数错误', code: 'VALIDATION_ERROR' }, 400);
  }
  const { username, password } = parsed.data;

  // 检查用户名是否已存在
  const existing = await getUserByUsername(username);
  if (existing) {
    return c.json({ error: '用户名已被占用', code: 'AUTH_ERROR' }, 409);
  }

  // 哈希密码（不存明文）
  const { salt, hash } = hashPassword(password);
  const user = await createUser({ username, passwordHash: hash, salt });

  const token = signToken({ userId: user.id });
  return c.json({ token, user: { id: user.id, username: user.username } }, 201);
});

// POST /api/auth/login
auth.post('/login', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = credentialsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? '参数错误', code: 'VALIDATION_ERROR' }, 400);
  }
  const { username, password } = parsed.data;

  const user = await getUserByUsername(username);
  if (!user) {
    return c.json({ error: '用户名或密码错误', code: 'AUTH_ERROR' }, 401);
  }

  const ok = verifyPassword(password, user.salt, user.passwordHash);
  if (!ok) {
    return c.json({ error: '用户名或密码错误', code: 'AUTH_ERROR' }, 401);
  }

  const token = signToken({ userId: user.id });
  return c.json({ token, user: { id: user.id, username: user.username } });
});

// GET /api/auth/me
auth.get('/me', optionalAuth, async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ error: '未登录', code: 'AUTH_ERROR' }, 401);
  }
  const user = await getUserById(userId);
  if (!user) {
    return c.json({ error: '用户不存在', code: 'AUTH_ERROR' }, 404);
  }
  return c.json(user);
});

export { auth };
