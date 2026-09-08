/**
 * Redis 客户端单例
 * 连接失败时仅记日志，不抛出异常（降级为无缓存）
 */
import Redis from 'ioredis';

const globalForRedis = globalThis as unknown as { redis?: Redis };

const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

export const redis =
  globalForRedis.redis ??
  new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    lazyConnect: false,
    connectTimeout: 5000,
    commandTimeout: 3000,
    protocol: 2,
    enableOfflineQueue: false,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.redis = redis;
}

// 连接错误仅记日志，不抛出（降级为无缓存）
redis.on('error', (err) => {
  console.error('[Redis] 连接错误：', err.message);
});
