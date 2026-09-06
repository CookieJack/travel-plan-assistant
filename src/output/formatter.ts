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

/**
 * Phase3 新增：Markdown 格式旅行方案
 * 结构与文本版一致，使用 Markdown 标题、列表、表格语法
 */
export function formatPlanMarkdown(state: TravelState): string {
  const { request, flights, hotels, activities, budget } = state;
  const lines: string[] = [];

  lines.push('# 🧳 您的专属旅行规划方案');
  lines.push('');
  lines.push(`- 📍 **目的地**：${request.destination}`);
  lines.push(`- 📅 **出行时间**：${request.travelDate}`);
  lines.push(`- 🗓️ **行程天数**：${request.days} 天`);
  if (request.travel_style) {
    lines.push(`- 🎒 **出行风格**：${request.travel_style}`);
  }
  if (request.user_preference) {
    lines.push(`- ❤️ **用户偏好**：${request.user_preference}`);
  }
  if (typeof request.budget_limit === 'number') {
    lines.push(`- 💰 **预算上限**：¥${request.budget_limit}`);
  }
  lines.push('');

  // 机票方案
  lines.push('## ✈️ 机票方案（FlightSearchAgent）');
  lines.push('');
  if (flights && flights.options.length > 0) {
    lines.push('| 方案 | 航司 | 航班号 | 出发 | 到达 | 舱位 | 价格 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    flights.options.forEach((f, i) => {
      lines.push(
        `| ${i + 1} | ${f.airline} | ${f.flightNo} | ${f.departTime} | ${f.arriveTime} | ${f.cabin} | ¥${f.price} |`,
      );
    });
  } else {
    lines.push('_暂无数据_');
  }
  lines.push('');

  // 酒店方案
  lines.push('## 🏨 酒店方案（HotelBookingAgent）');
  lines.push('');
  if (hotels && hotels.options.length > 0) {
    lines.push('| 方案 | 酒店 | 星级 | 房型 | 价格/晚 | 位置 |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    hotels.options.forEach((h, i) => {
      lines.push(
        `| ${i + 1} | ${h.name} | ${h.star}星 | ${h.roomType} | ¥${h.pricePerNight} | ${h.location} |`,
      );
    });
  } else {
    lines.push('_暂无数据_');
  }
  lines.push('');

  // 游玩行程
  lines.push('## 🎡 每日行程（ActivitiesAgent）');
  lines.push('');
  if (activities && activities.itinerary.length > 0) {
    activities.itinerary.forEach((day) => {
      lines.push(`### 第 ${day.day} 天`);
      lines.push('');
      day.activities.forEach((a) => {
        lines.push(`- **${a.time}** ${a.name}（¥${a.cost}）`);
        lines.push(`  - ${a.description}`);
      });
      lines.push('');
    });
  } else {
    lines.push('_暂无数据_');
    lines.push('');
  }

  // 预算汇总
  lines.push('## 💰 预算汇总（BudgetingAgent）');
  lines.push('');
  if (budget) {
    lines.push('| 类别 | 描述 | 金额 |');
    lines.push('| --- | --- | --- |');
    budget.breakdown.forEach((item) => {
      lines.push(`| ${item.category} | ${item.description} | ¥${item.amount} |`);
    });
    lines.push('');
    lines.push(`**💰 总预算：¥${budget.total}**`);
    lines.push('');

    if (budget.overBudget) {
      lines.push(`> ⚠️ **预算告警**：${budget.warning}`);
      lines.push('');
      if (budget.suggestions && budget.suggestions.length > 0) {
        lines.push('**💡 调整建议：**');
        budget.suggestions.forEach((s, i) => {
          lines.push(`${i + 1}. ${s}`);
        });
        lines.push('');
      }
    } else if (typeof request.budget_limit === 'number') {
      const remain = request.budget_limit - budget.total;
      lines.push(`✅ 预算充足，剩余 ¥${remain} 可自由支配`);
      lines.push('');
    }
  } else {
    lines.push('_暂无数据_');
    lines.push('');
  }

  lines.push('---');
  lines.push('_以上为模拟数据，仅供架构演示使用_');

  return lines.join('\n');
}

/**
 * Phase3 新增：JSON 格式旅行方案
 * 将 state 中已生成的结构化结果序列化为格式化 JSON 字符串
 * 包含 request / flights / hotels / activities / budget / summary
 */
export function formatPlanJson(state: TravelState): string {
  const payload = {
    request: state.request,
    flights: state.flights ?? null,
    hotels: state.hotels ?? null,
    activities: state.activities ?? null,
    budget: state.budget ?? null,
    summary: state.summary ?? null,
  };
  return JSON.stringify(payload, null, 2);
}
