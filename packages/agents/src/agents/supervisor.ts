/**
 * Travel Supervisor - 旅行主控Agent
 * 负责：接收用户旅行需求、拆解任务、分发到子Agent、汇总所有结果生成最终方案
 *
 * 在LangGraph架构中：
 * - 任务拆解与分发由 graph/buildGraph.ts 的工作流拓扑实现（并行调度4个子Agent）
 * - 本函数负责最终汇总：收集所有子Agent结果，生成完整旅行方案
 *
 * Phase2 增强：llm 模式下由豆包大模型生成最终方案文本，mock 模式保留原格式化逻辑
 */
import type { TravelState } from '@travel/shared';
import { formatPlan } from '@travel/shared';
import { isLLMMode, getLLM } from '@travel/llm';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

/** 主控 Agent 专属系统提示词 */
const SUPERVISOR_SYSTEM_PROMPT = `你是旅行主控智能体 Travel Supervisor。
你将收到机票、酒店、游玩活动、预算四个子智能体的模拟方案结果。
请将这些信息汇总为一份结构清晰、内容完整的中文旅行规划方案文本。

要求：
- 包含用户基本信息（目的地、出行时间、天数、预算、偏好、风格）
- 分板块呈现：机票方案、酒店方案、每日行程、预算汇总
- 若预算超支，需体现告警与调整建议
- 语言自然流畅，使用 emoji 装饰，排版清晰易读
- 直接输出最终方案文本，不要任何前缀解释或 JSON`;

/**
 * 主控Agent汇总节点
 * 输入：全局状态（应包含 flights、hotels、activities、budget）
 * 输出：最终旅行方案文本（写入 state.summary）
 */
export async function supervisorAgent(state: TravelState) {
  // mock 模式：沿用原格式化逻辑
  if (!isLLMMode()) {
    const summary = formatPlan(state);
    return { summary };
  }

  // llm 模式：调用豆包大模型生成最终方案
  try {
    const llm = getLLM();
    if (!llm) {
      throw new Error('LLM 未配置');
    }

    const userContent = JSON.stringify({
      request: state.request,
      flights: state.flights ?? null,
      hotels: state.hotels ?? null,
      activities: state.activities ?? null,
      budget: state.budget ?? null,
    });

    const response = await llm.invoke([
      new SystemMessage(SUPERVISOR_SYSTEM_PROMPT),
      new HumanMessage(userContent),
    ]);

    const summary =
      typeof response.content === 'string' ? response.content : '';

    return { summary: summary || formatPlan(state) };
  } catch (err) {
    console.error('[Supervisor] LLM 调用失败，回退 mock 模式：', (err as Error).message);
    const summary = formatPlan(state);
    return { summary };
  }
}
