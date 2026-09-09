/**
 * 游玩活动 Agent 工具集
 *
 * Phase12 新增：为 ActivitiesAgent 提供工具调用能力
 * 工具内部调用 @travel/mock-data，未来可替换为真实 API
 */
import { tool } from '@langchain/core/tools';
import { mockActivities } from '@travel/mock-data';
import type { TravelRequest } from '@travel/shared';

/** searchActivities 工具的输入参数 */
interface SearchActivitiesInput {
  destination: string;
  days: number;
  userPreference?: string;
}

/**
 * searchActivities 工具
 *
 * 根据目的地、出行天数和用户偏好生成每日游玩行程。
 * 内部调用 @travel/mock-data 的 mockActivities，返回每日活动列表。
 *
 * 未来接入真实景点/活动 API 时，只需替换此函数内部实现，
 * Agent 侧的工具调用逻辑无需改动。
 */
export const searchActivitiesTool = tool(
  async (input: SearchActivitiesInput): Promise<string> => {
    // 构造 TravelRequest 调用 mockActivities
    // mockActivities 根据 destination + days + user_preference 生成行程
    // travelDate 不影响活动结果，传空字符串占位
    const request: TravelRequest = {
      destination: input.destination,
      days: input.days,
      travelDate: '',
      user_preference: input.userPreference,
    };

    const itinerary = mockActivities(request);

    // 返回 JSON 字符串，LLM 可直接解析
    return JSON.stringify({ itinerary });
  },
  {
    name: 'searchActivities',
    description:
      '根据目的地、出行天数和用户偏好生成每日游玩行程，返回每日活动列表（含时间、活动名称、描述、费用）。',
    schema: {
      type: 'object',
      properties: {
        destination: {
          type: 'string',
          description: '旅行目的地城市名称',
        },
        days: {
          type: 'number',
          description: '出行天数',
        },
        userPreference: {
          type: 'string',
          description: '用户偏好（美食/自然风光/博物馆/亲子等），可选',
        },
      },
      required: ['destination', 'days'],
    } as const,
  },
);
