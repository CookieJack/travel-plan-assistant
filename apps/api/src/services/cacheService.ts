/**
 * 缓存服务
 * 封装 Redis 读写，统一处理序列化、反序列化、异常降级
 */
import { createHash } from 'node:crypto';
import net from 'node:net';
import type { TravelRequest } from '@travel/shared';
import { redis } from '../lib/redis.js';
import type { RunMode } from '../types/api.js';

// ============================================================
// 原生 Redis 命令执行（绕过 ioredis 6 + LangGraph 竞态问题）
// ============================================================

const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const REDIS_HOST = REDIS_URL.replace(/^redis:\/\//, '').split(':')[0] ?? '127.0.0.1';
const REDIS_PORT = parseInt(REDIS_URL.split(':').pop() ?? '6379', 10);

/**
 * 用原生 TCP socket 执行 Redis 命令（RESP2 协议）
 * 规避 ioredis 6 在 LangGraph 执行后 SET 命令卡死的问题
 */
function rawRedisCommand(args: (string | number)[], timeoutMs = 3000): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(REDIS_PORT, REDIS_HOST);
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error('command timeout'));
    }, timeoutMs);

    let buf = '';
    sock.once('connect', () => {
      // 构造 RESP2 请求
      let req = `*${args.length}\r\n`;
      for (const arg of args) {
        const s = String(arg);
        req += `$${Buffer.byteLength(s)}\r\n${s}\r\n`;
      }
      sock.write(req);
    });

    sock.on('data', (d) => {
      buf += d.toString();
      // 简单解析：找到第一个 \r\n 结尾的响应
      if (buf.includes('\r\n')) {
        clearTimeout(timer);
        sock.destroy();
        resolve(buf);
      }
    });

    sock.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ============================================================
// 缓存键工具函数
// ============================================================

/** 计算 SHA-256 摘要并截取前 n 位 */
function sha256(input: string, length = 16): string {
  return createHash('sha256').update(input).digest('hex').slice(0, length);
}

/**
 * 计算规划结果缓存键
 * 将请求参数排序后拼接，加上 mode，计算 SHA-256 前 16 位
 * 可选字段缺失时用空字符串占位，保证键稳定
 */
export function planResultKey(request: TravelRequest, mode: RunMode): string {
  const payload = [
    request.destination,
    String(request.days),
    request.travelDate,
    request.budget_limit != null ? String(request.budget_limit) : '',
    request.user_preference ?? '',
    request.travel_style ?? '',
    mode,
  ].join('|');
  return `plan:result:${sha256(payload)}`;
}

/** 计算规划详情缓存键 */
export function planDetailKey(id: string): string {
  return `plan:detail:${id}`;
}

/** 计算历史列表缓存键 */
export function planListKey(
  page: number,
  pageSize: number,
  destination?: string,
  userId?: string,
): string {
  const destHash = destination ? sha256(destination, 8) : 'none';
  const userTag = userId ?? 'anon';
  return `plan:list:${page}:${pageSize}:${destHash}:${userTag}`;
}

// ============================================================
// 缓存读写方法（全部带异常降级）
// ============================================================

/**
 * 从缓存获取值，解析失败或 Redis 异常时返回 null
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await redis.get(key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    console.error('[Cache] get 失败：', (err as Error).message);
    return null;
  }
}

/**
 * 写入缓存，带 TTL，写入失败仅记日志
 */
export async function cacheSet(
  key: string,
  value: unknown,
  ttlSeconds: number,
): Promise<void> {
  try {
    const data = JSON.stringify(value);
    // 用原生 TCP 执行 SET，规避 ioredis 6 + LangGraph 竞态
    await rawRedisCommand(['SET', key, data, 'EX', String(ttlSeconds)]);
  } catch (err) {
    console.error('[Cache] set 失败：', (err as Error).message);
  }
}

/**
 * 删除指定键，失败仅记日志
 */
export async function cacheDel(key: string): Promise<void> {
  try {
    await rawRedisCommand(['DEL', key]);
  } catch (err) {
    console.error('[Cache] del 失败：', (err as Error).message);
  }
}

/**
 * 删除匹配 pattern 的所有键（用于列表缓存失效）
 * 使用 keys + del 批量删除，开发环境数据量小
 */
export async function cacheDelByPattern(pattern: string): Promise<void> {
  try {
    // 先用 ioredis 获取 keys（GET 类命令不受竞态影响）
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await rawRedisCommand(['DEL', ...keys]);
    }
  } catch (err) {
    console.error('[Cache] delByPattern 失败：', (err as Error).message);
  }
}
