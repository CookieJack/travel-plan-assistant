/**
 * HotelBookingAgent - 酒店Agent
 * 负责：通过工具调用获取酒店方案、房型、价格、位置信息
 *
 * Phase12 改造：接入工具调用链路（复用 flightAgent 模式）
 * - mock 模式：固定逻辑直接调用 searchHotels 工具
 * - llm 模式：LLM 通过 Function Calling 自主决策调用 searchHotels 工具
 * 两种模式统一走工具调用链路，工具调用过程记录到 state.toolCalls
 *
 * Phase2 遗留：llm 模式失败时回退 mock 兜底（保留）
 */
import type { TravelState, HotelOption } from '@travel/shared';
import { validateHotelOutput } from '@travel/shared';
import { isLLMMode, getLLM } from '@travel/llm';
import {
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type AIMessage,
} from '@langchain/core/messages';
import { searchHotelsTool } from '../tools/hotelTools.js';
import { buildToolCallRecord, summarizeResult } from '../tools/utils.js';

/** 酒店 Agent 专属系统提示词（llm 模式，工具调用版） */
const HOTEL_SYSTEM_PROMPT = `你是酒店预订智能体 HotelBookingAgent。
你可以使用 searchHotels 工具根据用户需求查询酒店方案。

工作流程：
1. 调用 searchHotels 工具，传入目的地、出行天数、预算和出行风格
2. 基于工具返回的酒店数据，输出严格 JSON 格式的结果

输出格式必须为：
{
  "options": [
    {
      "name": "酒店名称",
      "star": 星级数字（2-5）,
      "roomType": "房型",
      "pricePerNight": 数字（单位：元/晚）,
      "location": "位置描述（含目的地）"
    }
  ]
}

要求：
- 必须调用 searchHotels 工具获取数据，不要凭空编造
- 根据用户预算上限、出行风格匹配酒店档次（穷游→经济型/青旅，轻奢→五星/奢华）
- 3 个方案档次与价格需有差异
- 只输出 JSON，不要任何解释、注释或 Markdown 代码块`;

/**
 * 从 TravelRequest 提取 searchHotels 工具参数
 * 过滤 undefined 值，避免 Prisma JSON 序列化报错
 */
function extractHotelArgs(state: TravelState): Record<string, unknown> {
  const args: Record<string, unknown> = {
    destination: state.request.destination,
    days: state.request.days,
  };
  if (state.request.budget_limit !== undefined) {
    args.budgetLimit = state.request.budget_limit;
  }
  if (state.request.travel_style !== undefined) {
    args.travelStyle = state.request.travel_style;
  }
  return args;
}

/**
 * 酒店Agent节点函数
 * 输入：全局状态（含用户需求）
 * 输出：酒店方案 + 工具调用记录（写入 state.hotels, state.toolCalls）
 */
export async function hotelAgent(state: TravelState) {
  const args = extractHotelArgs(state);

  // ========== mock 模式：固定逻辑直接调用工具 ==========
  if (!isLLMMode()) {
    const resultStr = await searchHotelsTool.invoke(args);
    const parsed = JSON.parse(resultStr) as { options: HotelOption[] };

    const record = buildToolCallRecord(
      'HotelBookingAgent',
      'searchHotels',
      args,
      summarizeResult(resultStr),
      'mock',
    );

    console.log('[HotelBookingAgent] 使用模式：mock(工具调用)');

    return {
      hotels: {
        agent: 'HotelBookingAgent' as const,
        options: Array.isArray(parsed.options) ? parsed.options : [],
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
    const llmWithTools = llm.bindTools([searchHotelsTool]);

    const userContent = JSON.stringify({
      destination: state.request.destination,
      days: state.request.days,
      travelDate: state.request.travelDate,
      budget_limit: state.request.budget_limit ?? null,
      travel_style: state.request.travel_style ?? null,
    });

    // 第一次调用：LLM 决策是否调用工具
    const firstResponse = (await llmWithTools.invoke([
      new SystemMessage(HOTEL_SYSTEM_PROMPT),
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
      const toolResult = await searchHotelsTool.invoke(toolCallArgs);

      // 构造 ToolMessage 回传给 LLM
      const toolMessage = new ToolMessage({
        content: toolResult,
        tool_call_id: toolCall.id,
        name: 'searchHotels',
      });

      // 第二次调用：LLM 基于工具结果生成最终输出
      const secondResponse = (await llmWithTools.invoke([
        new SystemMessage(HOTEL_SYSTEM_PROMPT),
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
    if (!validateHotelOutput(parsed)) {
      throw new Error('LLM 输出未通过结构校验');
    }

    // 构造工具调用记录（无论是否实际调用工具，都记录过程）
    const record = buildToolCallRecord(
      'HotelBookingAgent',
      'searchHotels',
      toolCallArgs,
      usedTool ? `工具返回 ${parsed.options.length} 家酒店` : 'LLM 未调用工具，直接生成',
      'llm',
    );

    console.log(
      `[HotelBookingAgent] 使用模式：llm(工具调用${usedTool ? '' : '/未调用工具'})`,
    );

    return {
      hotels: {
        agent: 'HotelBookingAgent' as const,
        options: parsed.options,
      },
      toolCalls: [record],
    };
  } catch (err) {
    console.error(
      '[HotelBookingAgent] LLM 工具调用失败，回退 mock 模式：',
      (err as Error).message,
    );
    console.log('[HotelBookingAgent] 使用模式：mock(LLM失败兜底)');

    // 兜底：mock 模式直接调用工具
    const resultStr = await searchHotelsTool.invoke(args);
    const parsed = JSON.parse(resultStr) as { options: HotelOption[] };

    const record = buildToolCallRecord(
      'HotelBookingAgent',
      'searchHotels',
      args,
      summarizeResult(resultStr),
      'mock',
    );

    return {
      hotels: {
        agent: 'HotelBookingAgent' as const,
        options: Array.isArray(parsed.options) ? parsed.options : [],
      },
      toolCalls: [record],
    };
  }
}
