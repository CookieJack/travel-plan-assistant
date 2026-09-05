/**
 * 旅行方案格式化输出
 * 将各Agent结果汇总为结构清晰的完整旅行方案文本
 */
import type { TravelState } from '../types/travel.js';

/** 格式化完整旅行方案 */
export function formatPlan(state: TravelState): string {
  const { request, flights, hotels, activities, budget } = state;
  const lines: string[] = [];

  lines.push('========================================');
  lines.push('       🧳 您的专属旅行规划方案');
  lines.push('========================================');
  lines.push('');
  lines.push(`📍 目的地：${request.destination}`);
  lines.push(`📅 出行时间：${request.travelDate}`);
  lines.push(`🗓️ 行程天数：${request.days} 天`);
  if (request.travel_style) {
    lines.push(`🎒 出行风格：${request.travel_style}`);
  }
  if (request.user_preference) {
    lines.push(`❤️ 用户偏好：${request.user_preference}`);
  }
  if (typeof request.budget_limit === 'number') {
    lines.push(`💰 预算上限：¥${request.budget_limit}`);
  }
  lines.push('');

  // 机票方案
  lines.push('----------------------------------------');
  lines.push('✈️  机票方案（FlightSearchAgent）');
  lines.push('----------------------------------------');
  if (flights) {
    flights.options.forEach((f, i) => {
      lines.push(`  方案${i + 1}：${f.airline} ${f.flightNo}`);
      lines.push(`    ${f.departTime} → ${f.arriveTime} | ${f.cabin} | ¥${f.price}`);
    });
  } else {
    lines.push('  暂无数据');
  }
  lines.push('');

  // 酒店方案
  lines.push('----------------------------------------');
  lines.push('🏨 酒店方案（HotelBookingAgent）');
  lines.push('----------------------------------------');
  if (hotels) {
    hotels.options.forEach((h, i) => {
      lines.push(`  方案${i + 1}：${h.name}（${h.star}星）`);
      lines.push(`    ${h.roomType} | ¥${h.pricePerNight}/晚 | ${h.location}`);
    });
  } else {
    lines.push('  暂无数据');
  }
  lines.push('');

  // 游玩行程
  lines.push('----------------------------------------');
  lines.push('🎡 每日行程（ActivitiesAgent）');
  lines.push('----------------------------------------');
  if (activities) {
    activities.itinerary.forEach((day) => {
      lines.push(`  【第 ${day.day} 天】`);
      day.activities.forEach((a) => {
        lines.push(`    ${a.time} ${a.name}（¥${a.cost}）`);
        lines.push(`      ${a.description}`);
      });
    });
  } else {
    lines.push('  暂无数据');
  }
  lines.push('');

  // 预算汇总
  lines.push('----------------------------------------');
  lines.push('💰 预算汇总（BudgetingAgent）');
  lines.push('----------------------------------------');
  if (budget) {
    budget.breakdown.forEach((item) => {
      lines.push(`  ${item.category}：${item.description} — ¥${item.amount}`);
    });
    lines.push('');
    lines.push(`  💰 总预算：¥${budget.total}`);

    // Phase1 增强：预算超支告警
    if (budget.overBudget) {
      lines.push('');
      lines.push(`  ⚠️  预算告警：${budget.warning}`);
      if (budget.suggestions && budget.suggestions.length > 0) {
        lines.push('  💡 调整建议：');
        budget.suggestions.forEach((s, i) => {
          lines.push(`    ${i + 1}. ${s}`);
        });
      }
    } else if (typeof request.budget_limit === 'number') {
      const remain = request.budget_limit - budget.total;
      lines.push(`  ✅ 预算充足，剩余 ¥${remain} 可自由支配`);
    }
  } else {
    lines.push('  暂无数据');
  }
  lines.push('');
  lines.push('========================================');
  lines.push('  以上为模拟数据，仅供架构演示使用');
  lines.push('========================================');

  return lines.join('\n');
}
