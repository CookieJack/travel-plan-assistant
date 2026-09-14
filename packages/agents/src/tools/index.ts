/**
 * 工具抽象层统一导出
 *
 * Phase10 新增：工具调用能力
 * Phase12 扩展：新增 searchHotelsTool / searchActivitiesTool + 共享辅助函数
 */
export { searchFlightsTool } from './flightTools.js';
export { searchHotelsTool } from './hotelTools.js';
export { searchActivitiesTool } from './activitiesTools.js';
export { buildToolCallRecord, summarizeResult, cleanUndefined } from './utils.js';
export type { AgentTools } from './types.js';
