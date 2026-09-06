/**
 * HotelBookingAgent - 酒店Agent
 * 负责：输出模拟酒店方案、房型、价格、位置信息
 *
 * Phase2 增强：llm 模式下由豆包大模型生成酒店方案，mock 模式保留原动态推理逻辑
 */
import type { TravelState, HotelOption } from '../types/travel.js';
import { validateHotelOutput } from '../types/travel.js';
import { mockHotels } from '../data/mockData.js';
import { isLLMMode, callLLMJson } from '../llm.js';

/** 酒店 Agent 专属系统提示词 */
const HOTEL_SYSTEM_PROMPT = `你是酒店预订智能体 HotelBookingAgent。
根据用户的旅行需求，生成 3 个模拟酒店方案。所有数据均为模拟生成，不调用任何真实酒店接口。

输出必须为严格 JSON，结构如下：
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
- 根据用户预算上限、出行风格匹配酒店档次（穷游→经济型/青旅，轻奢→五星/奢华）
- 3 个方案档次与价格需有差异
- 只输出 JSON，不要任何解释、注释或 Markdown 代码块`;

/**
 * 酒店Agent节点函数
 * 输入：全局状态（含用户需求）
 * 输出：酒店方案（写入 state.hotels）
 */
export async function hotelAgent(state: TravelState) {
  // mock 模式：沿用 phase1 动态推理逻辑
  if (!isLLMMode()) {
    const options = mockHotels(state.request);
    return {
      hotels: {
        agent: 'HotelBookingAgent' as const,
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

    const data = await callLLMJson<{ options: HotelOption[] }>(
      HOTEL_SYSTEM_PROMPT,
      userContent,
      validateHotelOutput,
      2,
      'HotelBookingAgent',
    );

    return {
      hotels: {
        agent: 'HotelBookingAgent' as const,
        options: Array.isArray(data.options) ? data.options : [],
      },
    };
  } catch (err) {
    console.error('[HotelBookingAgent] LLM 调用失败，回退 mock 模式：', (err as Error).message);
    console.log('[HotelBookingAgent] 使用模式：mock(LLM失败兜底)');
    const options = mockHotels(state.request);
    return {
      hotels: {
        agent: 'HotelBookingAgent' as const,
        options,
      },
    };
  }
}
