/**
 * Travel Supervisor - 旅行主控Agent
 * 负责：接收用户旅行需求、拆解任务、分发到子Agent、汇总所有结果生成最终方案
 *
 * 在LangGraph架构中：
 * - 任务拆解与分发由 graph/buildGraph.ts 的工作流拓扑实现（并行调度4个子Agent）
 * - 本函数负责最终汇总：收集所有子Agent结果，生成完整旅行方案
 */
import type { TravelState } from '../types/travel.js';
import { formatPlan } from '../output/formatter.js';

/**
 * 主控Agent汇总节点
 * 输入：全局状态（应包含 flights、hotels、activities、budget）
 * 输出：最终旅行方案文本（写入 state.summary）
 */
export function supervisorAgent(state: TravelState) {
  const summary = formatPlan(state);
  return { summary };
}
