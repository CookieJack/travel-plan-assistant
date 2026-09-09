/**
 * 机票 Agent 工具集
 *
 * Phase10 新增：为 FlightSearchAgent 提供工具调用能力
 * 工具内部调用 @travel/mock-data，未来可替换为真实 API
 */
import { tool } from '@langchain/core/tools';
import { mockFlights } from '@travel/mock-data';
import type { TravelRequest } from '@travel/shared';

/** searchFlights 工具的输入参数 */
interface SearchFlightsInput {
  destination: string;
  travelDate: string;
  budgetLimit?: number;
}

/**
 * searchFlights 工具
 *
 * 根据目的地、出行日期和预算查询可用机票方案。
 * 内部调用 @travel/mock-data 的 mockFlights，返回 3 个可选航班。
 *
 * 未来接入真实航司 API 时，只需替换此函数内部实现，
 * Agent 侧的工具调用逻辑无需改动。
 */
export const searchFlightsTool = tool(
  async (input: SearchFlightsInput): Promise<string> => {
    // 构造 TravelRequest 调用 mockFlights
    // mockFlights 仅根据 destination + budget 判断价格档位，days 不影响机票结果
    const request: TravelRequest = {
      destination: input.destination,
      days: 1,
      travelDate: input.travelDate,
      budget_limit: input.budgetLimit,
    };

    const options = mockFlights(request);

    // 返回 JSON 字符串，LLM 可直接解析
    return JSON.stringify({ options });
  },
  {
    name: 'searchFlights',
    description:
      '根据目的地、出行日期和预算查询可用机票方案，返回3个可选航班（含航司、航班号、出发时间、到达时间、价格、舱位）。',
    schema: {
      type: 'object',
      properties: {
        destination: {
          type: 'string',
          description: '旅行目的地城市名称',
        },
        travelDate: {
          type: 'string',
          description: '出行日期，格式 YYYY-MM-DD',
        },
        budgetLimit: {
          type: 'number',
          description: '机票预算上限（元），可选',
        },
      },
      required: ['destination', 'travelDate'],
    } as const,
  },
);
