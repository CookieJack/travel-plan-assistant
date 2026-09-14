/**
 * 数据库服务
 * 封装 Prisma 调用：保存规划结果、查询历史列表、查询详情
 */
import type { TravelState } from '@travel/shared';
import { prisma } from '../lib/prisma.js';
import type { RunMode } from '../types/api.js';
import { cacheGet, cacheSet, planDetailKey, planListKey } from './cacheService.js';

/** 详情缓存 TTL（秒） */
const PLAN_DETAIL_TTL = 600; // 10 分钟

/** 列表缓存 TTL（秒） */
const PLAN_LIST_TTL = 60; // 1 分钟

/** 持久化元信息（Phase14 扩展：支持 parentId/feedback；Phase16 扩展：userId） */
export interface SavePlanMeta {
  parentId?: string;
  feedback?: string;
  userId?: string;
}

/** 从 TravelState 提取并保存规划结果到数据库 */
export async function savePlan(
  state: TravelState,
  mode: RunMode,
  meta?: SavePlanMeta,
): Promise<{ id: string; createdAt: Date }> {
  const { request } = state;

  const record = await prisma.travelPlan.create({
    data: {
      destination: request.destination,
      days: request.days,
      travelDate: request.travelDate,
      userPreference: request.user_preference ?? null,
      budgetLimit: request.budget_limit ?? null,
      travelStyle: request.travel_style ?? null,
      mode,
      flights: (state.flights as unknown) ?? null,
      hotels: (state.hotels as unknown) ?? null,
      activities: (state.activities as unknown) ?? null,
      budget: (state.budget as unknown) ?? null,
      summary: state.summary ?? null,
      toolCalls: (state.toolCalls as unknown) ?? null,
      cityPlans: state.cityPlans ? (state.cityPlans as unknown) : null,
      parentId: meta?.parentId ?? null,
      feedback: meta?.feedback ?? null,
      userId: meta?.userId ?? null,
    },
    select: {
      id: true,
      createdAt: true,
    },
  });

  return { id: record.id, createdAt: record.createdAt };
}

/** 历史列表查询参数（Phase16 新增 userId） */
export interface ListPlansParams {
  page: number;
  pageSize: number;
  destination?: string;
  userId?: string;
}

/** 历史列表查询结果 */
export interface ListPlansResult {
  items: Array<{
    id: string;
    destination: string;
    days: number;
    travelDate: string;
    budgetLimit: number | null;
    mode: string;
    summary: string | null;
    createdAt: Date;
  }>;
  total: number;
  page: number;
  pageSize: number;
}

/** 查询历史规划列表（分页 + 目的地过滤 + Phase16 用户过滤）
 *  - 有 userId：只返回该用户的规划
 *  - 无 userId：只返回匿名规划（userId: null），向后兼容
 */
export async function listPlans({
  page,
  pageSize,
  destination,
  userId,
}: ListPlansParams): Promise<ListPlansResult> {
  // 查询列表缓存（含 userId 维度）
  const listCacheKey = planListKey(page, pageSize, destination, userId);
  const cached = await cacheGet<ListPlansResult>(listCacheKey);
  if (cached) {
    return cached;
  }

  const where: Record<string, unknown> = {};
  if (destination) {
    where.destination = { contains: destination };
  }
  // Phase16：按用户过滤；未登录只看匿名规划
  where.userId = userId ?? null;

  const [items, total] = await Promise.all([
    prisma.travelPlan.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        destination: true,
        days: true,
        travelDate: true,
        budgetLimit: true,
        mode: true,
        summary: true,
        createdAt: true,
      },
    }),
    prisma.travelPlan.count({ where }),
  ]);

  const result: ListPlansResult = { items, total, page, pageSize };
  // 写入缓存（失败仅记日志）
  await cacheSet(listCacheKey, result, PLAN_LIST_TTL);
  return result;
}

/** 查询单个规划详情 */
export async function getPlanById(id: string) {
  // 查询详情缓存
  const detailCacheKey = planDetailKey(id);
  const cached = await cacheGet(detailCacheKey);
  if (cached !== null) {
    return cached;
  }

  const plan = await prisma.travelPlan.findUnique({ where: { id } });
  if (plan) {
    // 写入缓存（失败仅记日志）
    await cacheSet(detailCacheKey, plan, PLAN_DETAIL_TTL);
  }
  return plan;
}

// ============================================================
// Phase16 新增：用户 CRUD
// ============================================================

/** 创建用户（注册） */
export async function createUser(data: {
  username: string;
  passwordHash: string;
  salt: string;
}) {
  return prisma.user.create({
    data,
    select: { id: true, username: true },
  });
}

/** 按用户名查询用户（含密码字段，供登录验证） */
export async function getUserByUsername(username: string) {
  return prisma.user.findUnique({
    where: { username },
  });
}

/** 按 ID 查询用户（不含密码） */
export async function getUserById(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      username: true,
      defaultStyle: true,
      defaultBudget: true,
      defaultPreference: true,
    },
  });
}

/** 更新用户默认偏好 */
export async function updateUserPreferences(
  userId: string,
  data: {
    defaultStyle?: string | null;
    defaultBudget?: number | null;
    defaultPreference?: string | null;
  },
) {
  return prisma.user.update({
    where: { id: userId },
    data,
    select: {
      id: true,
      username: true,
      defaultStyle: true,
      defaultBudget: true,
      defaultPreference: true,
    },
  });
}
