/**
 * 旅行规划路由
 * POST /api/plan
 */
import { Hono } from 'hono';
import { type TravelRequest, travelRequestSchema, validate } from '@travel/shared';
import { generatePlan } from '../services/travelService.js';
import type { OutputFormat, RunMode } from '../types/api.js';
import { optionalAuth } from '../middleware/auth.js';

const plan = new Hono();

/** 校验并解析请求体（Phase13：改用 zod 校验） */
export function parseRequestBody(body: unknown): TravelRequest | { error: string } {
  try {
    return validate(travelRequestSchema, body);
  } catch (err) {
    return { error: (err as { message: string }).message };
  }
}

/** 解析查询参数中的 mode */
export function parseMode(raw: string | undefined): RunMode {
  if (raw === 'llm') return 'llm';
  return 'mock';
}

/** 解析查询参数中的 format */
function parseFormat(raw: string | undefined): OutputFormat {
  if (raw === 'text' || raw === 'markdown' || raw === 'json') return raw;
  return 'json';
}

plan.post('/', optionalAuth, async (c) => {
  // 解析查询参数
  const mode = parseMode(c.req.query('mode'));
  const format = parseFormat(c.req.query('format'));
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

  // 调用旅行规划服务（传入 userId，关联规划归属）
  try {
    const result = await generatePlan(parsed, mode, format, { userId });
    return c.json(result);
  } catch (err) {
    console.error('[PlanRoute] 规划失败：', (err as Error).message);
    return c.json(
      { error: `规划失败：${(err as Error).message}`, code: 'INTERNAL_ERROR' },
      500,
    );
  }
});

export { plan };
