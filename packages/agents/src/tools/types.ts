/**
 * 工具抽象层类型定义
 *
 * Phase10 新增：为 Agent 提供工具调用能力
 * - 每个 Agent 拥有自己的工具列表，互不干扰
 * - 工具本身可以是 Mock 实现，未来替换为真实 API 只需改工具内部实现
 */
import type { DynamicStructuredTool } from '@langchain/core/tools';

/**
 * Agent 可用工具集合
 * 每个 Agent 拥有自己的工具列表，互不干扰
 * 未列出的 Agent 工具列表为空数组
 */
export interface AgentTools {
  flight: DynamicStructuredTool[];
  // hotel / activities / budgeting 留空，后续阶段扩展
}
