/**
 * 酒店 Agent 工具集
 *
 * Phase12 新增：为 HotelBookingAgent 提供工具调用能力
 * 工具内部调用 @travel/mock-data，未来可替换为真实 API
 */
import { tool } from '@langchain/core/tools';
import { mockHotels } from '@travel/mock-data';
import type { TravelRequest } from '@travel/shared';

/** searchHotels 工具的输入参数 */
interface SearchHotelsInput {
  destination: string;
  days: number;
  budgetLimit?: number;
  travelStyle?: string;
}

/**
 * searchHotels 工具
 *
 * 根据目的地、出行天数、预算和出行风格查询可用酒店方案。
 * 内部调用 @travel/mock-data 的 mockHotels，返回 3 个可选酒店。
 *
 * 未来接入真实酒店 API 时，只需替换此函数内部实现，
 * Agent 侧的工具调用逻辑无需改动。
 */
export const searchHotelsTool = tool(
  async (input: SearchHotelsInput): Promise<string> => {
    // 构造 TravelRequest 调用 mockHotels
    // mockHotels 根据 destination + budget_limit + travel_style 判断价格档位
    // days 与 travelDate 不影响酒店结果，travelDate 传空字符串占位
    const request: TravelRequest = {
      destination: input.destination,
      days: input.days,
      travelDate: '',
      budget_limit: input.budgetLimit,
      travel_style: input.travelStyle,
    };

    const options = mockHotels(request);

    // 返回 JSON 字符串，LLM 可直接解析
    return JSON.stringify({ options });
  },
  {
    name: 'searchHotels',
    description:
      '根据目的地、出行天数、预算和出行风格查询可用酒店方案，返回3个可选酒店（含名称、星级、房型、每晚价格、位置）。',
    schema: {
      type: 'object',
      properties: {
        destination: {
          type: 'string',
          description: '旅行目的地城市名称',
        },
        days: {
          type: 'number',
          description: '出行天数（用于计算住宿晚数）',
        },
        budgetLimit: {
          type: 'number',
          description: '酒店预算上限（元），可选',
        },
        travelStyle: {
          type: 'string',
          description: '出行风格（穷游/舒适/轻奢），可选',
        },
      },
      required: ['destination', 'days'],
    } as const,
  },
);
