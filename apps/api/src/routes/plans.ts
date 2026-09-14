/**
 * 历史规划路由
 * GET  /api/plans              历史列表（分页 + 目的地过滤）
 * GET  /api/plans/:id          单个规划详情
 * POST /api/plans/:id/revise          基于用户反馈修订规划（非流式）
 * POST /api/plans/:id/revise/stream   基于用户反馈修订规划（流式）
 */
import { Hono } from 'hono';
import { paginationSchema, reviseRequestSchema, validate } from '@travel/shared';
import { listPlans, getPlanById } from '../services/dbService.js';
import { revisePlan, revisePlanStream } from '../services/travelService.js';
import { withSSE } from '../lib/sse.js';
import { optionalAuth } from '../middleware/auth.js';

const plans = new Hono();

// GET /api/plans
plans.get('/', optionalAuth, async (c) => {
  const { page, pageSize, destination } = validate(paginationSchema, {
    page: c.req.query('page'),
    pageSize: c.req.query('pageSize'),
    destination: c.req.query('destination'),
  });
  // Phase16：按 userId 过滤（未登录只看匿名规划）
  const userId = c.get('userId');

  try {
    const result = await listPlans({ page, pageSize, destination, userId });
    return c.json(result);
  } catch (err) {
    console.error('[PlansRoute] 查询历史列表失败：', (err as Error).message);
    return c.json(
      { error: '查询历史列表失败', code: 'INTERNAL_ERROR' },
      500,
    );
  }
});

// POST /api/plans/:id/revise —— 非流式修订
plans.post('/:id/revise', optionalAuth, async (c) => {
  const planId = c.req.param('id');
  const userId = c.get('userId');
  const body = await c.req.json().catch(() => ({}));

  // 校验请求体（与 plan.ts parseRequestBody 风格一致，路由内处理校验错误）
  let feedback: string;
  let mode: 'mock' | 'llm' | undefined;
  try {
    const parsed = validate(reviseRequestSchema, body);
    feedback = parsed.feedback;
    mode = parsed.mode;
  } catch (err) {
    return c.json(
      { error: (err as { message: string }).message, code: 'VALIDATION_ERROR' },
      400,
    );
  }

  try {
    const result = await revisePlan(planId, feedback, mode, { userId });
    return c.json(result);
  } catch (err) {
    const message = (err as Error).message;
    if (message.startsWith('规划不存在')) {
      return c.json({ error: message, code: 'NOT_FOUND' }, 404);
    }
    console.error('[PlansRoute] 修订规划失败：', message);
    return c.json({ error: '修订规划失败', code: 'INTERNAL_ERROR' }, 500);
  }
});

// POST /api/plans/:id/revise/stream —— 流式修订
plans.post('/:id/revise/stream', optionalAuth, async (c) => {
  const planId = c.req.param('id');
  const userId = c.get('userId');
  const body = await c.req.json().catch(() => ({}));

  // 校验请求体
  let feedback: string;
  let mode: 'mock' | 'llm' | undefined;
  try {
    const parsed = validate(reviseRequestSchema, body);
    feedback = parsed.feedback;
    mode = parsed.mode;
  } catch (err) {
    return c.json(
      { error: (err as { message: string }).message, code: 'VALIDATION_ERROR' },
      400,
    );
  }

  return withSSE(c, revisePlanStream(planId, feedback, mode, { userId }));
});

// GET /api/plans/:id
plans.get('/:id', async (c) => {
  const id = c.req.param('id');

  try {
    const plan = await getPlanById(id);
    if (!plan) {
      return c.json({ error: '规划记录不存在', code: 'NOT_FOUND' }, 404);
    }
    return c.json(plan);
  } catch (err) {
    console.error('[PlansRoute] 查询规划详情失败：', (err as Error).message);
    return c.json(
      { error: '查询规划详情失败', code: 'INTERNAL_ERROR' },
      500,
    );
  }
});

export { plans };
