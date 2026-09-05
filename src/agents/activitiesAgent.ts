/**
 * ActivitiesAgent - 游玩活动Agent
 * 负责：输出目的地每日游玩行程、特色活动推荐
 */
import type { TravelState } from '../types/travel.js';
import { mockActivities } from '../data/mockData.js';

/**
 * 游玩活动Agent节点函数
 * 输入：全局状态（含用户需求）
 * 输出：每日行程（写入 state.activities）
 */
export function activitiesAgent(state: TravelState) {
  const itinerary = mockActivities(state.request);
  return {
    activities: {
      agent: 'ActivitiesAgent' as const,
      itinerary,
    },
  };
}
