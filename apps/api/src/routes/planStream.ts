/**
 * SSE 流式旅行规划路由
 * POST /api/plan/stream
 *
 * Phase11 新增：实时推送 Agent 执行进度与工具调用记录
 */
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { generatePlanStream } from '../services/travelService.js';
import { parseRequestBody, parseMode } from './plan.js';

const planStream = new Hono();

planStream.post('/', async (c) => {
  // 解析 mode
  const mode = parseMode(c.req.query('mode'));

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

  // SSE 响应头
  c.header('Content-Type', 'text/event-stream; charset=utf-8');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');
  c.header('X-Accel-Buffering', 'no');

  return streamSSE(
    c,
    async (stream) => {
      try {
        for await (const event of generatePlanStream(parsed, mode)) {
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event.data),
          });
        }
      } catch (err) {
        console.error('[PlanStreamRoute] 流式规划失败：', (err as Error).message);
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ message: (err as Error).message }),
        });
      }
    },
    async (err, stream) => {
      console.error('[PlanStreamRoute] SSE 连接异常：', (err as Error).message);
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ message: (err as Error).message }),
      });
    },
  );
});

export { planStream };
