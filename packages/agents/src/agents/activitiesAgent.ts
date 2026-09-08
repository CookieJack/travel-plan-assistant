/**
 * ActivitiesAgent - 游玩活动Agent
 * 负责：输出目的地每日游玩行程、特色活动推荐
 *
 * Phase2 增强：llm 模式下由豆包大模型生成每日行程，mock 模式保留原动态推理逻辑
 */
import type { TravelState, DayItinerary } from '@travel/shared';
import { validateActivitiesOutput } from '@travel/shared';
import { mockActivities } from '@travel/mock-data';
import { isLLMMode, callLLMJson } from '@travel/llm';

/** 活动 Agent 专属系统提示词 */
const ACTIVITIES_SYSTEM_PROMPT = `你是游玩活动智能体 ActivitiesAgent。
根据用户的旅行需求，为每一天生成模拟游玩行程。所有数据均为模拟生成，不调用任何真实景点接口。

输出必须为严格 JSON，结构如下：
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
- 行程天数必须等于用户提供的 days
- 根据用户偏好（美食/自然风光/博物馆/亲子等）优先安排匹配的活动
- 每天安排 3-4 个活动，时间合理不重叠
- 只输出 JSON，不要任何解释、注释或 Markdown 代码块`;

/**
 * 游玩活动Agent节点函数
 * 输入：全局状态（含用户需求）
 * 输出：每日行程（写入 state.activities）
 */
export async function activitiesAgent(state: TravelState) {
  // mock 模式：沿用 phase1 动态推理逻辑
  if (!isLLMMode()) {
    const itinerary = mockActivities(state.request);
    return {
      activities: {
        agent: 'ActivitiesAgent' as const,
        itinerary,
      },
    };
  }

  // llm 模式：调用豆包大模型生成
  try {
    const userContent = JSON.stringify({
      destination: state.request.destination,
      days: state.request.days,
      travelDate: state.request.travelDate,
      user_preference: state.request.user_preference ?? null,
    });

    const data = await callLLMJson<{ itinerary: DayItinerary[] }>(
      ACTIVITIES_SYSTEM_PROMPT,
      userContent,
      validateActivitiesOutput,
      2,
      'ActivitiesAgent',
    );

    return {
      activities: {
        agent: 'ActivitiesAgent' as const,
        itinerary: Array.isArray(data.itinerary) ? data.itinerary : [],
      },
    };
  } catch (err) {
    console.error('[ActivitiesAgent] LLM 调用失败，回退 mock 模式：', (err as Error).message);
    console.log('[ActivitiesAgent] 使用模式：mock(LLM失败兜底)');
    const itinerary = mockActivities(state.request);
    return {
      activities: {
        agent: 'ActivitiesAgent' as const,
        itinerary,
      },
    };
  }
}
