/**
 * Phase16 新增：用户偏好路由
 * GET  /api/user/preferences  - 获取当前用户默认偏好（需登录）
 * PUT  /api/user/preferences  - 更新当前用户默认偏好（需登录）
 */
import { Hono } from 'hono';
import { z } from '@travel/shared';
import { optionalAuth } from '../middleware/auth.js';
import { getUserById, updateUserPreferences } from '../services/dbService.js';

const user = new Hono();

/** 偏好更新请求体校验（所有字段可选） */
const preferencesSchema = z.object({
  defaultStyle: z.string().trim().optional().nullable(),
  defaultBudget: z.number().positive().optional().nullable(),
  defaultPreference: z.string().trim().optional().nullable(),
});

// GET /api/user/preferences
user.get('/preferences', optionalAuth, async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ error: '未登录', code: 'AUTH_ERROR' }, 401);
  }
  const u = await getUserById(userId);
  if (!u) {
    return c.json({ error: '用户不存在', code: 'AUTH_ERROR' }, 404);
  }
  return c.json({
    defaultStyle: u.defaultStyle ?? null,
    defaultBudget: u.defaultBudget ?? null,
    defaultPreference: u.defaultPreference ?? null,
  });
});

// PUT /api/user/preferences
user.put('/preferences', optionalAuth, async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ error: '未登录', code: 'AUTH_ERROR' }, 401);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = preferencesSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? '参数错误', code: 'VALIDATION_ERROR' }, 400);
  }
  const { defaultStyle, defaultBudget, defaultPreference } = parsed.data;
  const u = await updateUserPreferences(userId, {
    defaultStyle: defaultStyle ?? null,
    defaultBudget: defaultBudget ?? null,
    defaultPreference: defaultPreference ?? null,
  });
  return c.json({
    defaultStyle: u.defaultStyle ?? null,
    defaultBudget: u.defaultBudget ?? null,
    defaultPreference: u.defaultPreference ?? null,
  });
});

export { user };
