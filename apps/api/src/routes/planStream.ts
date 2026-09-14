/**
 * SSE 流式旅行规划路由
 * POST /api/plan/stream
 *
 * Phase11 新增：实时推送 Agent 执行进度与工具调用记录
 * Phase14 重构：SSE 响应逻辑抽取到 lib/sse.ts
 */
import { Hono } from 'hono';
import { generatePlanStream } from '../services/travelService.js';
import { withSSE } from '../lib/sse.js';
import { parseRequestBody, parseMode } from './plan.js';
import { optionalAuth } from '../middleware/auth.js';

const planStream = new Hono();

planStream.post('/', optionalAuth, async (c) => {
  // 解析 mode
  const mode = parseMode(c.req.query('mode'));
  // Phase16：从鉴权中间件获取 userId（未登录为 undefined）
  const userId = c.get('userId');

  // 解析请求体
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: '请求体必须为合法 JSON', code: 'VALIDATION_ERROR' }, 400);
  }

  const parsed = parseRequestBody(body);
  if ('error' in parsed) {
    return c.json({ error: parsed.error, code: 'VALIDATION_ERROR' }, 400);
  }

  return withSSE(c, generatePlanStream(parsed, mode, { userId }));
});

export { planStream };
