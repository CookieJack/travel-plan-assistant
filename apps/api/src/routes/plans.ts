/**
 * 历史规划路由
 * GET /api/plans      历史列表（分页 + 目的地过滤）
 * GET /api/plans/:id  单个规划详情
 */
import { Hono } from 'hono';
import { listPlans, getPlanById } from '../services/dbService.js';

const plans = new Hono();

/** 解析页码 */
function parsePage(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return 1;
  return n;
}

/** 解析每页数量（最大 50） */
function parsePageSize(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return 10;
  return Math.min(n, 50);
}

// GET /api/plans
plans.get('/', async (c) => {
  const page = parsePage(c.req.query('page'));
  const pageSize = parsePageSize(c.req.query('pageSize'));
  const destination = c.req.query('destination') || undefined;

  try {
    const result = await listPlans({ page, pageSize, destination });
    return c.json(result);
  } catch (err) {
    console.error('[PlansRoute] 查询历史列表失败：', (err as Error).message);
    return c.json(
      { error: '查询历史列表失败', code: 'INTERNAL_ERROR' },
      500,
    );
  }
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
