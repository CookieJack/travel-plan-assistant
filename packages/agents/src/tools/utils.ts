/**
 * 工具调用共享辅助函数
 *
 * Phase12 新增：从 flightAgent 抽取 buildToolCallRecord / summarizeResult / cleanUndefined，
 * 供 flightAgent / hotelAgent / activitiesAgent 共享，避免重复代码。
 * 函数行为与 Phase10 flightAgent 中的实现完全一致。
 */
import type { ToolCallRecord } from '@travel/shared';

/**
 * 清理对象中的 undefined 值（Prisma JSON 序列化不支持 undefined）
 */
export function cleanUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

/**
 * 构造工具调用记录
 */
export function buildToolCallRecord(
  agent: string,
  toolName: string,
  args: Record<string, unknown>,
  resultSummary: string,
  mode: 'mock' | 'llm',
): ToolCallRecord {
  return {
    agent,
    toolName,
    args: cleanUndefined(args),
    resultSummary,
    timestamp: new Date().toISOString(),
    mode,
  };
}

/**
 * 截断结果摘要，避免 state 过大
 */
export function summarizeResult(result: string, maxLen = 200): string {
  if (result.length <= maxLen) return result;
  return result.slice(0, maxLen) + '...';
}
