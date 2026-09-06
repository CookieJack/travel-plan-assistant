/**
 * BudgetingAgent - 预算Agent
 * 负责：汇总机票+酒店+活动费用，生成总预算、费用明细
 * 依赖：flights / hotels / activities 三个Agent的结果
 *
 * Phase2 增强：llm 模式下由豆包大模型汇总费用并判断超支，mock 模式保留原本地计算逻辑
 */
import type { TravelState, CostItem } from '../types/travel.js';
import { validateBudgetOutput } from '../types/travel.js';
import { isLLMMode, callLLMJson } from '../llm.js';

/** 预算 Agent 专属系统提示词 */
const BUDGET_SYSTEM_PROMPT = `你是预算规划智能体 BudgetingAgent。
根据机票、酒店、游玩活动的模拟方案，汇总费用并判断是否超出用户预算上限。

输出必须为严格 JSON，结构如下：
{
  "total": 总费用数字（元）,
  "breakdown": [
    {
      "category": "费用类别（机票/酒店/游玩活动）",
      "description": "费用描述",
      "amount": 数字（元）
    }
  ],
  "overBudget": true或false,
  "warning": "超支时的告警提示字符串，未超支则为 null",
  "suggestions": ["超支时的调整建议字符串数组，未超支则为 null"]
}

计算规则：
- 机票费用：取首个方案价格 × 2（往返）
- 酒店费用：取首个方案每晚价格 × (出行天数-1) 晚（最少 1 晚）
- 活动费用：所有行程活动费用总和
- 若总费用 > 用户预算上限，则 overBudget 为 true，并给出告警与 2-3 条调整建议
- 只输出 JSON，不要任何解释、注释或 Markdown 代码块`;

/**
 * 预算Agent节点函数
 * 输入：全局状态（需包含 flights、hotels、activities）
 * 输出：总预算与费用明细（写入 state.budget）
 */
export async function budgetingAgent(state: TravelState) {
  // mock 模式：沿用 phase1 本地计算逻辑
  if (!isLLMMode()) {
    return computeBudgetMock(state);
  }

  // llm 模式：调用豆包大模型汇总
  try {
    const userContent = JSON.stringify({
      days: state.request.days,
      budget_limit: state.request.budget_limit ?? null,
      flights: state.flights ?? null,
      hotels: state.hotels ?? null,
      activities: state.activities ?? null,
    });

    // T 由 validateBudgetOutput 的类型守卫推断（raw 输出，不含 agent 字段）
    const data = await callLLMJson(
      BUDGET_SYSTEM_PROMPT,
      userContent,
      validateBudgetOutput,
      2,
      'BudgetingAgent',
    );

    return {
      budget: {
        agent: 'BudgetingAgent' as const,
        total: typeof data.total === 'number' ? data.total : 0,
        breakdown: Array.isArray(data.breakdown) ? data.breakdown : [],
        overBudget: Boolean(data.overBudget),
        warning: data.warning || undefined,
        suggestions: data.suggestions || undefined,
      },
    };
  } catch (err) {
    console.error('[BudgetingAgent] LLM 调用失败，回退 mock 模式：', (err as Error).message);
    console.log('[BudgetingAgent] 使用模式：mock(LLM失败兜底)');
    return computeBudgetMock(state);
  }
}

/** mock 模式下的本地预算计算（phase1 原逻辑，完整保留） */
function computeBudgetMock(state: TravelState) {
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
