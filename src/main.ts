/**
 * CLI 入口
 * 接收用户旅行需求（目的地、出行天数、出行时间、预算、偏好、出行风格），
 * 启动多Agent工作流，输出最终方案
 *
 * 用法：
 *   pnpm dev -- <目的地> <天数> <出行时间> [预算上限] [用户偏好] [出行风格]
 *   示例：pnpm dev -- 东京 5 2026-10-01 10000 美食 舒适
 *
 * 若未提供参数，则进入交互式输入
 */
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { buildTravelGraph } from './graph/buildGraph.js';
import type { TravelRequest } from './types/travel.js';

/** 解析命令行参数 */
function parseArgs(): TravelRequest | null {
  // 过滤掉 pnpm/npm 传递的 '--' 分隔符
  const args = process.argv.slice(2).filter((a) => a !== '--');
  if (args.length >= 3) {
    const [destination, daysStr, travelDate, budgetStr, preference, style] = args;
    const days = parseInt(daysStr, 10);
    if (!Number.isNaN(days) && days > 0) {
      const request: TravelRequest = {
        destination,
        days,
        travelDate,
      };
      if (budgetStr) {
        const budget = parseInt(budgetStr, 10);
        if (!Number.isNaN(budget) && budget > 0) {
          request.budget_limit = budget;
        }
      }
      if (preference) request.user_preference = preference;
      if (style) request.travel_style = style;
      return request;
    }
  }
  return null;
}

/** 交互式输入 */
async function promptInput(): Promise<TravelRequest> {
  const rl = readline.createInterface({ input, output });
  console.log('🧳 旅行规划助手 - 请输入您的旅行需求\n');
  const destination = await rl.question('📍 目的地：');
  const daysStr = await rl.question('🗓️ 出行天数：');
  const travelDate = await rl.question('📅 出行时间（YYYY-MM-DD）：');
  const budgetStr = await rl.question('💰 预算上限（元，可留空）：');
  const preference = await rl.question('❤️ 用户偏好（美食/自然风光/博物馆/亲子等，可留空）：');
  const style = await rl.question('🎒 出行风格（穷游/舒适/轻奢，可留空）：');
  rl.close();

  const days = parseInt(daysStr, 10);
  if (Number.isNaN(days) || days <= 0) {
    throw new Error(`无效的出行天数：${daysStr}`);
  }

  const request: TravelRequest = {
    destination: destination.trim(),
    days,
    travelDate: travelDate.trim(),
  };

  const budget = budgetStr.trim() ? parseInt(budgetStr, 10) : NaN;
  if (!Number.isNaN(budget) && budget > 0) {
    request.budget_limit = budget;
  }
  if (preference.trim()) request.user_preference = preference.trim();
  if (style.trim()) request.travel_style = style.trim();

  return request;
}

/** 主函数 */
async function main() {
  // 1. 获取用户输入
  const request = parseArgs() ?? (await promptInput());

  console.log('\n🚀 正在启动多Agent旅行规划工作流...\n');

  // 2. 构建并执行工作流
  const app = buildTravelGraph();
  const result = await app.invoke({ request });

  // 3. 输出最终方案
  console.log(result.summary ?? '⚠️ 未能生成旅行方案');
}

main().catch((err) => {
  console.error('❌ 运行出错：', err);
  process.exit(1);
});
