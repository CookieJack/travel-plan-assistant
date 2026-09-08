/**
 * 旅行规划服务
 * 封装 Agent 调用，处理 mode/format，不修改 Agent 内部逻辑
 */
import { buildTravelGraph } from '@travel/agents';
import { setMode } from '@travel/llm';
import {
  formatPlanMarkdown,
  type TravelRequest,
  type TravelState,
} from '@travel/shared';
import type { OutputFormat, RunMode } from '../types/api.js';
import { savePlan } from './dbService.js';
import {
  cacheGet,
  cacheSet,
  planResultKey,
  cacheDelByPattern,
} from './cacheService.js';

/** 规划结果缓存 TTL（秒） */
const PLAN_RESULT_TTL: Record<RunMode, number> = {
  mock: 3600, // 1 小时
  llm: 1800, // 30 分钟
};

/** 持久化元信息 */
interface PersistMeta {
  id: string;
  createdAt: string;
}

/**
 * 执行旅行规划并持久化结果
 * @param request 用户旅行需求
 * @param mode 运行模式 mock | llm
 * @param format 输出格式 text | markdown | json
 * @returns 规划结果 + 持久化元信息（id/createdAt）
 */
export async function generatePlan(
  request: TravelRequest,
  mode: RunMode = 'mock',
  format: OutputFormat = 'json',
): Promise<
  | (TravelState & PersistMeta)
  | ({ format: OutputFormat; content: string } & PersistMeta)
> {
  // 设置运行模式
  setMode(mode);

  // 计算规划结果缓存键
  const cacheKey = planResultKey(request, mode);

  // 查询缓存：命中则跳过 Agent 执行
  let result: TravelState | null = await cacheGet<TravelState>(cacheKey);
  if (result) {
    console.log('[TravelService] 规划结果命中缓存，跳过 Agent 执行');
  } else {
    // 未命中：构建并执行工作流
    const app = buildTravelGraph();
    result = await app.invoke({ request });
    // 写入缓存（失败仅记日志，不阻断）
    await cacheSet(cacheKey, result, PLAN_RESULT_TTL[mode]);
  }

  // 持久化到数据库（失败不阻断，仅记日志）
  let meta: PersistMeta = { id: '', createdAt: new Date().toISOString() };
  try {
    const saved = await savePlan(result, mode);
    meta = { id: saved.id, createdAt: saved.createdAt.toISOString() };
  } catch (err) {
    console.error('[TravelService] 持久化规划结果失败：', (err as Error).message);
  }

  // 新规划生成后，清理历史列表缓存（保证列表能看到新记录）
  await cacheDelByPattern('plan:list:*');

  // 根据格式返回结果
  switch (format) {
    case 'text':
      return {
        format: 'text',
        content: result.summary ?? '⚠️ 未能生成旅行方案',
        ...meta,
      };
    case 'markdown':
      return {
        format: 'markdown',
        content: formatPlanMarkdown(result),
        ...meta,
      };
    case 'json':
    default:
      return {
        ...result,
        ...meta,
      };
  }
}
