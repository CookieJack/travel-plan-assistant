/**
 * SSE 流式响应工具（Phase14 抽取：供 planStream 和 reviseStream 复用）
 */
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { SSEEvent } from '../services/travelService.js';

/**
 * 将 SSEEvent 异步生成器转换为 Hono SSE 响应
 */
export function withSSE(c: Context, generator: AsyncGenerator<SSEEvent>) {
  c.header('Content-Type', 'text/event-stream; charset=utf-8');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');
  c.header('X-Accel-Buffering', 'no');

  return streamSSE(
    c,
    async (stream) => {
      try {
        for await (const event of generator) {
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event.data),
          });
        }
      } catch (err) {
        console.error('[SSE] 流式输出失败：', (err as Error).message);
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ message: (err as Error).message }),
        });
      }
    },
    async (err, stream) => {
      console.error('[SSE] 连接异常：', (err as Error).message);
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ message: (err as Error).message }),
      });
    },
  );
}
