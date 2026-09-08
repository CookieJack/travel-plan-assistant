/**
 * 健康检查路由
 */
import { Hono } from 'hono';

const health = new Hono();

health.get('/', (c) => {
  return c.json({ status: 'ok', service: 'travel-plan-api' });
});

export { health };
