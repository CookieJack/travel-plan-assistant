/**
 * FlightSearchAgent - 机票Agent
 * 负责：输出模拟机票方案、价格、时段信息
 */
import type { TravelState } from '../types/travel.js';
import { mockFlights } from '../data/mockData.js';

/**
 * 机票Agent节点函数
 * 输入：全局状态（含用户需求）
 * 输出：机票方案（写入 state.flights）
 */
export function flightAgent(state: TravelState) {
  const options = mockFlights(state.request);
  return {
    flights: {
      agent: 'FlightSearchAgent' as const,
      options,
    },
  };
}
