/**
 * API 请求封装
 * 封装对后端三个接口的调用
 */
import type { TravelRequest, TravelState } from '@travel/shared';

/** 运行模式 */
export type RunMode = 'mock' | 'llm';

/** 规划元信息 */
export interface PlanMeta {
  id: string;
  createdAt: string;
}

/** JSON 格式规划响应 */
export type JsonPlanResponse = TravelState & PlanMeta;

/** 历史列表项 */
export interface PlanListItem {
  id: string;
  destination: string;
  days: number;
  travelDate: string;
  budgetLimit: number | null;
  mode: string;
  summary: string | null;
  createdAt: string;
}

/** 历史列表响应 */
export interface PlanListResponse {
  items: PlanListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** 规划详情（数据库完整记录） */
export interface PlanDetail extends TravelState {
  id: string;
  createdAt: string;
  updatedAt: string;
  mode: string;
  userPreference: string | null;
  budgetLimit: number | null;
  travelStyle: string | null;
}

/** API 基础路径（Vite dev server 代理 /api 到后端） */
const API_BASE = '/api';

/** 错误响应 */
interface ErrorResponse {
  error: string;
  code: string;
}

/**
 * 生成旅行规划
 * POST /api/plan?mode={mode}&format=json
 */
export async function generatePlan(
  request: TravelRequest,
  mode: RunMode,
): Promise<JsonPlanResponse> {
  const url = `${API_BASE}/plan?mode=${mode}&format=json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  const data = await res.json();
  if (!res.ok) {
    const err = data as ErrorResponse;
    throw new Error(err.error || '规划生成失败');
  }
  return data as JsonPlanResponse;
}

/**
 * 查询历史规划列表
 * GET /api/plans?page={page}&pageSize={pageSize}&destination={destination}
 */
export async function listPlans(
  page: number,
  pageSize: number,
  destination?: string,
): Promise<PlanListResponse> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (destination && destination.trim()) {
    params.set('destination', destination.trim());
  }

  const res = await fetch(`${API_BASE}/plans?${params.toString()}`);
  const data = await res.json();
  if (!res.ok) {
    const err = data as ErrorResponse;
    throw new Error(err.error || '查询历史列表失败');
  }
  return data as PlanListResponse;
}

/**
 * 查询规划详情
 * GET /api/plans/:id
 *
 * 注意：详情接口返回的是数据库记录（request 字段被拆分为独立列），
 * 需转换为包含 request 对象的格式，以兼容 PlanResult 组件。
 */
export async function getPlanById(id: string): Promise<PlanDetail> {
  const res = await fetch(`${API_BASE}/plans/${id}`);
  const data = await res.json();
  if (!res.ok) {
    const err = data as ErrorResponse;
    throw new Error(err.error || '查询规划详情失败');
  }

  // 将数据库记录的扁平字段重组为 request 对象
  const record = data as Record<string, unknown>;
  const request: TravelRequest = {
    destination: record.destination as string,
    days: record.days as number,
    travelDate: record.travelDate as string,
  };
  if (record.userPreference) request.user_preference = record.userPreference as string;
  if (record.budgetLimit !== null && record.budgetLimit !== undefined) {
    request.budget_limit = record.budgetLimit as number;
  }
  if (record.travelStyle) request.travel_style = record.travelStyle as string;

  return {
    ...(data as PlanDetail),
    request,
  } as PlanDetail;
}
