/**
 * FlightSearchAgent - 机票Agent
 * 负责：通过工具调用获取机票方案、价格、时段信息
 *
 * Phase10 改造：接入工具调用链路
 * - mock 模式：固定逻辑直接调用 searchFlights 工具
 * - llm 模式：LLM 通过 Function Calling 自主决策调用 searchFlights 工具
 * 两种模式统一走工具调用链路，工具调用过程记录到 state.toolCalls
 *
 * Phase2 遗留：llm 模式失败时回退 mock 兜底（保留）
 */
import type { TravelState, FlightOption } from '@travel/shared';
import { validateFlightOutput } from '@travel/shared';
import { isLLMMode, getLLM } from '@travel/llm';
import {
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type AIMessage,
} from '@langchain/core/messages';
import { searchFlightsTool } from '../tools/flightTools.js';
import { buildToolCallRecord, summarizeResult } from '../tools/utils.js';

/** 机票 Agent 专属系统提示词（llm 模式，工具调用版） */
const FLIGHT_SYSTEM_PROMPT = `你是机票查询智能体 FlightSearchAgent。
你可以使用 searchFlights 工具根据用户需求查询机票方案。

工作流程：
1. 调用 searchFlights 工具，传入目的地、出行日期和预算
2. 基于工具返回的机票数据，输出严格 JSON 格式的结果

输出格式必须为：
{
  "options": [
    {
      "airline": "航空公司名称",
      "flightNo": "航班号",
      "departTime": "HH:MM",
      "arriveTime": "HH:MM",
      "price": 数字（单位：元）,
      "cabin": "经济舱 / 商务舱 / 头等舱"
    }
  ]
}

要求：
- 必须调用 searchFlights 工具获取数据，不要凭空编造
- 根据用户预算上限、出行风格匹配舱位与价格档位
- 只输出 JSON，不要任何解释、注释或 Markdown 代码块`;

/**
 * 从 TravelRequest 提取 searchFlights 工具参数
 * 过滤 undefined 值，避免 Prisma JSON 序列化报错
 */
function extractFlightArgs(state: TravelState): Record<string, unknown> {
  const args: Record<string, unknown> = {
    destination: state.request.destination,
    travelDate: state.request.travelDate,
  };
  if (state.request.budget_limit !== undefined) {
    args.budgetLimit = state.request.budget_limit;
  }
  return args;
}

/**
 * 机票Agent节点函数
 * 输入：全局状态（含用户需求）
 * 输出：机票方案 + 工具调用记录（写入 state.flights, state.toolCalls）
 */
export async function flightAgent(state: TravelState) {
  const args = extractFlightArgs(state);

  // ========== mock 模式：固定逻辑直接调用工具 ==========
  if (!isLLMMode()) {
    const resultStr = await searchFlightsTool.invoke(args);
    const parsed = JSON.parse(resultStr) as { options: FlightOption[] };

    const record = buildToolCallRecord(
      'FlightSearchAgent',
      'searchFlights',
      args,
      summarizeResult(resultStr),
      'mock',
    );

    console.log('[FlightSearchAgent] 使用模式：mock(工具调用)');

    return {
      flights: {
        agent: 'FlightSearchAgent' as const,
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
    const llmWithTools = llm.bindTools([searchFlightsTool]);

    const userContent = JSON.stringify({
      destination: state.request.destination,
      days: state.request.days,
      travelDate: state.request.travelDate,
      budget_limit: state.request.budget_limit ?? null,
      travel_style: state.request.travel_style ?? null,
    });

    // 第一次调用：LLM 决策是否调用工具
    const firstResponse = (await llmWithTools.invoke([
      new SystemMessage(FLIGHT_SYSTEM_PROMPT),
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
      const toolResult = await searchFlightsTool.invoke(toolCallArgs);

      // 构造 ToolMessage 回传给 LLM
      const toolMessage = new ToolMessage({
        content: toolResult,
        tool_call_id: toolCall.id,
        name: 'searchFlights',
      });

      // 第二次调用：LLM 基于工具结果生成最终输出
      const secondResponse = (await llmWithTools.invoke([
        new SystemMessage(FLIGHT_SYSTEM_PROMPT),
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
    if (!validateFlightOutput(parsed)) {
      throw new Error('LLM 输出未通过结构校验');
    }

    // 构造工具调用记录（无论是否实际调用工具，都记录过程）
    const record = buildToolCallRecord(
      'FlightSearchAgent',
      'searchFlights',
      toolCallArgs,
      usedTool ? `工具返回 ${parsed.options.length} 条航班` : 'LLM 未调用工具，直接生成',
      'llm',
    );

    console.log(
      `[FlightSearchAgent] 使用模式：llm(工具调用${usedTool ? '' : '/未调用工具'})`,
    );

    return {
      flights: {
        agent: 'FlightSearchAgent' as const,
        options: parsed.options,
      },
      toolCalls: [record],
    };
  } catch (err) {
    console.error(
      '[FlightSearchAgent] LLM 工具调用失败，回退 mock 模式：',
      (err as Error).message,
    );
    console.log('[FlightSearchAgent] 使用模式：mock(LLM失败兜底)');

    // 兜底：mock 模式直接调用工具
    const resultStr = await searchFlightsTool.invoke(args);
    const parsed = JSON.parse(resultStr) as { options: FlightOption[] };

    const record = buildToolCallRecord(
      'FlightSearchAgent',
      'searchFlights',
      args,
      summarizeResult(resultStr),
      'mock',
    );

    return {
      flights: {
        agent: 'FlightSearchAgent' as const,
        options: Array.isArray(parsed.options) ? parsed.options : [],
      },
      toolCalls: [record],
    };
  }
}
