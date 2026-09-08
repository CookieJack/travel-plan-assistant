/**
 * API 请求/响应类型定义
 */
import type { TravelRequest, TravelState } from '@travel/shared';

/** 运行模式 */
export type RunMode = 'mock' | 'llm';

/** 输出格式 */
export type OutputFormat = 'text' | 'markdown' | 'json';

/** 规划请求的查询参数 */
export interface PlanQuery {
  mode?: RunMode;
  format?: OutputFormat;
}

/** 规划请求体（复用 TravelRequest） */
export type PlanRequestBody = TravelRequest;

/** 格式化文本响应 */
export interface TextFormatResponse {
  format: OutputFormat;
  content: string;
}

/** 规划成功响应：format=json 时为 TravelState + 持久化元信息，否则为 TextFormatResponse + 元信息 */
export interface PlanMeta {
  id: string;
  createdAt: string;
}

/** JSON 格式规划响应 */
export type JsonPlanResponse = TravelState & PlanMeta;

/** 文本/Markdown 格式规划响应 */
export type TextPlanResponse = TextFormatResponse & PlanMeta;

/** 规划成功响应 */
export type PlanResponse = JsonPlanResponse | TextPlanResponse;

/** 错误响应 */
export interface ErrorResponse {
  error: string;
  code: 'VALIDATION_ERROR' | 'INTERNAL_ERROR' | 'NOT_FOUND';
}
