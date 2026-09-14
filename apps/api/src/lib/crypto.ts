/**
 * Phase16 新增：密码哈希 + Token 签名/验证
 * 全部使用 Node.js 内置 crypto 模块，零外部依赖
 */
import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';

/** Token 签名密钥（生产环境必须通过环境变量设置） */
const TOKEN_SECRET = process.env.TOKEN_SECRET || 'dev-secret-change-me';

/** Token 有效期：7 天 */
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 生成盐 + 哈希密码
 * 使用 scrypt（Node 内置），无需 bcrypt
 */
export function hashPassword(password: string): { salt: string; hash: string } {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

/**
 * 验证密码（常量时间比较，防时序攻击）
 */
export function verifyPassword(password: string, salt: string, storedHash: string): boolean {
  try {
    const inputHash = scryptSync(password, salt, 64);
    const storedBuf = Buffer.from(storedHash, 'hex');
    if (inputHash.length !== storedBuf.length) return false;
    return timingSafeEqual(inputHash, storedBuf);
  } catch {
    return false;
  }
}

/**
 * 生成签名 Token：base64url(payload).hmac
 * 不引入 jsonwebtoken，用 HMAC-SHA256 自签
 */
export function signToken(payload: { userId: string }): string {
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: Date.now() + TOKEN_TTL_MS }),
  ).toString('base64url');
  const sig = createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/**
 * 验证 Token，返回 payload 或 null（签名错误或过期均返回 null）
 */
export function verifyToken(token: string): { userId: string } | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    if (typeof payload.userId !== 'string') return null;
    return { userId: payload.userId };
  } catch {
    return null;
  }
}
