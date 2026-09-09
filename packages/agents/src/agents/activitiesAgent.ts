/**
 * ActivitiesAgent - 游玩活动Agent
 * 负责：通过工具调用生成目的地每日游玩行程、特色活动推荐
 *
 * Phase12 改造：接入工具调用链路（复用 flightAgent 模式）
 * - mock 模式：固定逻辑直接调用 searchActivities 工具
 * - llm 模式：LLM 通过 Function Calling 自主决策调用 searchActivities 工具
 * 两种模式统一走工具调用链路，工具调用过程记录到 state.toolCalls
 *
 * Phase2 遗留：llm 模式失败时回退 mock 兜底（保留）
 */
import type { TravelState, DayItinerary } from '@travel/shared';
import { validateActivitiesOutput } from '@travel/shared';
import { isLLMMode, getLLM } from '@travel/llm';
import {
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type AIMessage,
} from '@langchain/core/messages';
import { searchActivitiesTool } from '../tools/activitiesTools.js';
import { buildToolCallRecord, summarizeResult } from '../tools/utils.js';

/** 活动 Agent 专属系统提示词（llm 模式，工具调用版） */
const ACTIVITIES_SYSTEM_PROMPT = `你是游玩活动智能体 ActivitiesAgent。
你可以使用 searchActivities 工具根据用户需求生成每日游玩行程。

工作流程：
1. 调用 searchActivities 工具，传入目的地、出行天数和用户偏好
2. 基于工具返回的行程数据，输出严格 JSON 格式的结果

输出格式必须为：
{
  "itinerary": [
    {
      "day": 天数数字,
      "activities": [
        {
          "time": "HH:MM",
          "name": "活动名称",
          "description": "活动描述",
          "cost": 数字（单位：元）
        }
      ]
    }
  ]
}

要求：
- 必须调用 searchActivities 工具获取数据，不要凭空编造
- 行程天数必须等于用户提供的 days
- 根据用户偏好（美食/自然风光/博物馆/亲子等）优先安排匹配的活动
- 每天安排 3-4 个活动，时间合理不重叠
- 只输出 JSON，不要任何解释、注释或 Markdown 代码块`;

/**
 * 从 TravelRequest 提取 searchActivities 工具参数
 * 过滤 undefined 值，避免 Prisma JSON 序列化报错
 */
function extractActivitiesArgs(state: TravelState): Record<string, unknown> {
  const args: Record<string, unknown> = {
    destination: state.request.destination,
    days: state.request.days,
  };
  if (state.request.user_preference !== undefined) {
    args.userPreference = state.request.user_preference;
  }
  return args;
}

/**
 * 游玩活动Agent节点函数
 * 输入：全局状态（含用户需求）
 * 输出：每日行程 + 工具调用记录（写入 state.activities, state.toolCalls）
 */
export async function activitiesAgent(state: TravelState) {
  const args = extractActivitiesArgs(state);

  // ========== mock 模式：固定逻辑直接调用工具 ==========
  if (!isLLMMode()) {
    const resultStr = await searchActivitiesTool.invoke(args);
    const parsed = JSON.parse(resultStr) as { itinerary: DayItinerary[] };

    const record = buildToolCallRecord(
      'ActivitiesAgent',
      'searchActivities',
      args,
      summarizeResult(resultStr),
      'mock',
    );

    console.log('[ActivitiesAgent] 使用模式：mock(工具调用)');

    return {
      activities: {
        agent: 'ActivitiesAgent' as const,
        itinerary: Array.isArray(parsed.itinerary) ? parsed.itinerary : [],
      },
      toolCalls: [record],
    };
  }

  // ========== llm 模式：LLM 自主决策调用工具 ==========
  try {
    const llm = getLLM();
    if (!llm) {
      throw new Error('LLM 未配置');
    }

    // 绑定工具
    const llmWithTools = llm.bindTools([searchActivitiesTool]);

    const userContent = JSON.stringify({
      destination: state.request.destination,
      days: state.request.days,
      travelDate: state.request.travelDate,
      user_preference: state.request.user_preference ?? null,
    });

    // 第一次调用：LLM 决策是否调用工具
    const firstResponse = (await llmWithTools.invoke([
      new SystemMessage(ACTIVITIES_SYSTEM_PROMPT),
      new HumanMessage(userContent),
    ])) as AIMessage;

    let finalContent: string;
    let toolCallArgs: Record<string, unknown> = args;
    let usedTool = false;

    // 检查是否有工具调用
    if (firstResponse.tool_calls && firstResponse.tool_calls.length > 0) {
      usedTool = true;
      const toolCall = firstResponse.tool_calls[0];
      toolCallArgs = toolCall.args as Record<string, unknown>;

      // 执行工具
      const toolResult = await searchActivitiesTool.invoke(toolCallArgs);

      // 构造 ToolMessage 回传给 LLM
      const toolMessage = new ToolMessage({
        content: toolResult,
        tool_call_id: toolCall.id,
        name: 'searchActivities',
      });

      // 第二次调用：LLM 基于工具结果生成最终输出
      const secondResponse = (await llmWithTools.invoke([
        new SystemMessage(ACTIVITIES_SYSTEM_PROMPT),
        new HumanMessage(userContent),
        firstResponse,
        toolMessage,
      ])) as AIMessage;

      finalContent =
        typeof secondResponse.content === 'string'
          ? secondResponse.content
          : '';
    } else {
      // LLM 未调用工具，直接使用其输出
      finalContent =
        typeof firstResponse.content === 'string'
          ? firstResponse.content
          : '';
    }

    if (!finalContent) {
      throw new Error('LLM 返回内容为空');
    }

    // 解析并校验输出
    const parsed = JSON.parse(finalContent) as unknown;
    if (!validateActivitiesOutput(parsed)) {
      throw new Error('LLM 输出未通过结构校验');
    }

    // 构造工具调用记录（无论是否实际调用工具，都记录过程）
    const record = buildToolCallRecord(
      'ActivitiesAgent',
      'searchActivities',
      toolCallArgs,
      usedTool
        ? `工具返回 ${parsed.itinerary.length} 天行程`
        : 'LLM 未调用工具，直接生成',
      'llm',
    );

    console.log(
      `[ActivitiesAgent] 使用模式：llm(工具调用${usedTool ? '' : '/未调用工具'})`,
    );

    return {
      activities: {
        agent: 'ActivitiesAgent' as const,
        itinerary: parsed.itinerary,
      },
      toolCalls: [record],
    };
  } catch (err) {
    console.error(
      '[ActivitiesAgent] LLM 工具调用失败，回退 mock 模式：',
      (err as Error).message,
    );
    console.log('[ActivitiesAgent] 使用模式：mock(LLM失败兜底)');

    // 兜底：mock 模式直接调用工具
    const resultStr = await searchActivitiesTool.invoke(args);
    const parsed = JSON.parse(resultStr) as { itinerary: DayItinerary[] };

    const record = buildToolCallRecord(
      'ActivitiesAgent',
      'searchActivities',
      args,
      summarizeResult(resultStr),
      'mock',
    );

    return {
      activities: {
        agent: 'ActivitiesAgent' as const,
        itinerary: Array.isArray(parsed.itinerary) ? parsed.itinerary : [],
      },
      toolCalls: [record],
    };
  }
}
