/**
 * Phase16 新增：可选鉴权中间件
 * 解析 Authorization: Bearer <token>，将 userId 写入 c.set('userId')
 * 未登录或 Token 无效时不阻断（userId 为 undefined），保证匿名规划向后兼容
 */
import type { MiddlewareHandler } from 'hono';
import { verifyToken } from '../lib/crypto.js';

declare module 'hono' {
  interface ContextVariableMap {
    userId?: string;
  }
}

export const optionalAuth: MiddlewareHandler = async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const payload = verifyToken(token);
    if (payload) {
      c.set('userId', payload.userId);
    }
  }
  await next();
};
