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

  // Phase1 增强：对比用户预算上限，输出超支告警与调整建议
  const budgetLimit = request.budget_limit;
  let overBudget = false;
  let warning: string | undefined;
  let suggestions: string[] | undefined;

  if (typeof budgetLimit === 'number' && total > budgetLimit) {
    overBudget = true;
    const exceed = total - budgetLimit;
    warning = `预估总花费 ¥${total} 超出预算上限 ¥${budgetLimit}，超支 ¥${exceed}。`;
    suggestions = [
      '建议选择更低价的机票方案（红眼航班/折扣经济舱）',
      '建议下调酒店档次，选择经济型酒店或减少住宿天数',
      '建议精简游玩活动，优先免费景点与低消费项目',
    ];
  }

  return {
    budget: {
      agent: 'BudgetingAgent' as const,
      total,
      breakdown,
      overBudget,
      warning,
      suggestions,
    },
  };
}
