/**
 * BudgetingAgent - 预算Agent
 * 负责：汇总机票+酒店+活动费用，生成总预算、费用明细
 * 依赖：flights / hotels / activities 三个Agent的结果
 */
import type { TravelState, CostItem } from '../types/travel.js';

/**
 * 预算Agent节点函数
 * 输入：全局状态（需包含 flights、hotels、activities）
 * 输出：总预算与费用明细（写入 state.budget）
 */
export function budgetingAgent(state: TravelState) {
  const breakdown: CostItem[] = [];
  const { request, flights, hotels, activities } = state;

  // 1. 机票费用：取首个方案，往返
  if (flights && flights.options.length > 0) {
    const flight = flights.options[0];
    const flightCost = flight.price * 2; // 往返
    breakdown.push({
      category: '机票',
      description: `${flight.airline} ${flight.flightNo} 往返`,
      amount: flightCost,
    });
  }

  // 2. 酒店费用：取首个方案，住 (days-1) 晚
  if (hotels && hotels.options.length > 0) {
    const hotel = hotels.options[0];
    const nights = Math.max(request.days - 1, 1);
    const hotelCost = hotel.pricePerNight * nights;
    breakdown.push({
      category: '酒店',
      description: `${hotel.name} ${hotel.roomType} × ${nights}晚`,
      amount: hotelCost,
    });
  }

  // 3. 活动费用：所有行程活动费用总和
  if (activities && activities.itinerary.length > 0) {
    const activityCost = activities.itinerary.reduce(
      (sum, day) => sum + day.activities.reduce((s, a) => s + a.cost, 0),
      0,
    );
    breakdown.push({
      category: '游玩活动',
      description: `${activities.itinerary.length}天行程活动费用`,
      amount: activityCost,
    });
  }

  const total = breakdown.reduce((sum, item) => sum + item.amount, 0);

  return {
    budget: {
      agent: 'BudgetingAgent' as const,
      total,
      breakdown,
    },
  };
}
