/**
 * FlightSearchAgent - 机票Agent
 * 负责：输出模拟机票方案、价格、时段信息
 *
 * Phase2 增强：llm 模式下由豆包大模型生成机票方案，mock 模式保留原动态推理逻辑
 */
import type { TravelState, FlightOption } from '../types/travel.js';
import { validateFlightOutput } from '../types/travel.js';
import { mockFlights } from '../data/mockData.js';
import { isLLMMode, callLLMJson } from '../llm.js';

/** 机票 Agent 专属系统提示词 */
const FLIGHT_SYSTEM_PROMPT = `你是机票查询智能体 FlightSearchAgent。
根据用户的旅行需求，生成 3 个模拟机票方案。所有数据均为模拟生成，不调用任何真实航司接口。

输出必须为严格 JSON，结构如下：
{
  "options": [
    {
      "airline": "航空公司名称（需体现目的地航线）",
      "flightNo": "航班号",
      "departTime": "HH:MM",
      "arriveTime": "HH:MM",
      "price": 数字（单位：元）,
      "cabin": "经济舱 / 商务舱 / 头等舱"
    }
  ]
}

要求：
- 根据用户预算上限、出行风格匹配舱位与价格档位（穷游→经济舱低价，轻奢→商务/头等舱高价）
- 3 个方案时段与价格需有差异
- 只输出 JSON，不要任何解释、注释或 Markdown 代码块`;

/**
 * 机票Agent节点函数
 * 输入：全局状态（含用户需求）
 * 输出：机票方案（写入 state.flights）
 */
export async function flightAgent(state: TravelState) {
  // mock 模式：沿用 phase1 动态推理逻辑
  if (!isLLMMode()) {
    const options = mockFlights(state.request);
    return {
      flights: {
        agent: 'FlightSearchAgent' as const,
        options,
      },
    };
  }

  // llm 模式：调用豆包大模型生成
  try {
    const userContent = JSON.stringify({
      destination: state.request.destination,
      days: state.request.days,
      travelDate: state.request.travelDate,
      budget_limit: state.request.budget_limit ?? null,
      travel_style: state.request.travel_style ?? null,
    });

    const data = await callLLMJson<{ options: FlightOption[] }>(
      FLIGHT_SYSTEM_PROMPT,
      userContent,
      validateFlightOutput,
      2,
      'FlightSearchAgent',
    );

    return {
      flights: {
        agent: 'FlightSearchAgent' as const,
        options: Array.isArray(data.options) ? data.options : [],
      },
    };
  } catch (err) {
    console.error('[FlightSearchAgent] LLM 调用失败，回退 mock 模式：', (err as Error).message);
    console.log('[FlightSearchAgent] 使用模式：mock(LLM失败兜底)');
    const options = mockFlights(state.request);
    return {
      flights: {
        agent: 'FlightSearchAgent' as const,
        options,
      },
    };
  }
}
