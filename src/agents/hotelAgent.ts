/**
 * HotelBookingAgent - 酒店Agent
 * 负责：输出模拟酒店方案、房型、价格、位置信息
 */
import type { TravelState } from '../types/travel.js';
import { mockHotels } from '../data/mockData.js';

/**
 * 酒店Agent节点函数
 * 输入：全局状态（含用户需求）
 * 输出：酒店方案（写入 state.hotels）
 */
export function hotelAgent(state: TravelState) {
  const options = mockHotels(state.request);
  return {
    hotels: {
      agent: 'HotelBookingAgent' as const,
      options,
    },
  };
}
