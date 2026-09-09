/**
 * 旅行规划路由
 * POST /api/plan
 */
import { Hono } from 'hono';
import type { TravelRequest } from '@travel/shared';
import { generatePlan } from '../services/travelService.js';
import type { OutputFormat, RunMode } from '../types/api.js';

const plan = new Hono();

/** 校验并解析请求体 */
export function parseRequestBody(body: unknown): TravelRequest | { error: string } {
  if (typeof body !== 'object' || body === null) {
    return { error: '请求体必须为 JSON 对象' };
  }

  const data = body as Record<string, unknown>;

  // destination: 必填非空字符串
  if (typeof data.destination !== 'string' || data.destination.trim() === '') {
    return { error: 'destination 为必填的非空字符串' };
  }

  // days: 必填正整数
  if (typeof data.days !== 'number' || !Number.isInteger(data.days) || data.days <= 0) {
    return { error: 'days 为必填的正整数' };
  }

  // travelDate: 必填非空字符串
  if (typeof data.travelDate !== 'string' || data.travelDate.trim() === '') {
    return { error: 'travelDate 为必填的非空字符串' };
  }

  const request: TravelRequest = {
    destination: data.destination.trim(),
    days: data.days,
    travelDate: data.travelDate.trim(),
  };

  // budget_limit: 可选正数
  if (data.budget_limit !== undefined && data.budget_limit !== null) {
    if (typeof data.budget_limit !== 'number' || data.budget_limit <= 0) {
      return { error: 'budget_limit 必须为正数' };
    }
    request.budget_limit = data.budget_limit;
  }

  // user_preference: 可选字符串
  if (data.user_preference !== undefined && data.user_preference !== null) {
    if (typeof data.user_preference !== 'string') {
      return { error: 'user_preference 必须为字符串' };
    }
    request.user_preference = data.user_preference.trim();
  }

  // travel_style: 可选字符串
  if (data.travel_style !== undefined && data.travel_style !== null) {
    if (typeof data.travel_style !== 'string') {
      return { error: 'travel_style 必须为字符串' };
    }
    request.travel_style = data.travel_style.trim();
  }

  return request;
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

plan.post('/', async (c) => {
  // 解析查询参数
  const mode = parseMode(c.req.query('mode'));
  const format = parseFormat(c.req.query('format'));

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

  // 调用旅行规划服务
  try {
    const result = await generatePlan(parsed, mode, format);
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
