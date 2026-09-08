/**
 * CLI 入口
 * 接收用户旅行需求（目的地、出行天数、出行时间、预算、偏好、出行风格），
 * 启动多Agent工作流，输出最终方案
 *
 * 用法：
 *   pnpm dev -- [--mode mock|llm] [--format text|markdown|json] [--output <path>] <目的地> <天数> <出行时间> [预算上限] [用户偏好] [出行风格]
 *   示例：pnpm dev -- --mode llm --format markdown --output plan.md 东京 5 2026-10-01 10000 美食 舒适
 *
 * 模式选项（Phase2 新增）：
 *   --mode mock  使用 phase1 模拟逻辑（默认，不消耗 LLM token，便于调试）
 *   --mode llm   使用真实豆包大模型生成各 Agent 结果
 *
 * 输出选项（Phase3 新增）：
 *   --format text      纯文本输出（默认）
 *   --format markdown  Markdown 格式输出
 *   --format json      结构化 JSON 输出
 *   --output <path>    将方案写入指定文件（同时仍在 stdout 输出）
 *
 * 若未提供参数，则进入交互式输入
 */
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { writeFile } from 'node:fs/promises';
import { buildTravelGraph } from '@travel/agents';
import type { TravelRequest } from '@travel/shared';
import { setMode, type RunMode } from '@travel/llm';
import { formatPlan, formatPlanMarkdown, formatPlanJson } from '@travel/shared';

/** 输出格式（Phase3 新增） */
type OutputFormat = 'text' | 'markdown' | 'json';

/** 从命令行参数中提取运行模式、输出格式、输出路径，返回剩余的位置参数 */
function extractOptions(args: string[]): {
  mode: RunMode;
  format: OutputFormat;
  outputPath: string | null;
  rest: string[];
} {
  let mode: RunMode = 'mock'; // 默认 mock 模式
  let format: OutputFormat = 'text'; // 默认文本格式
  let outputPath: string | null = null;
  const rest: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mode') {
      const value = args[i + 1];
      if (value === 'mock' || value === 'llm') {
        mode = value;
        i++;
      } else {
        throw new Error(`无效的 --mode 值：${value}，仅支持 mock 或 llm`);
      }
    } else if (args[i] === '--format') {
      const value = args[i + 1];
      if (value === 'text' || value === 'markdown' || value === 'json') {
        format = value;
        i++;
      } else {
        throw new Error(
          `无效的 --format 值：${value}，仅支持 text / markdown / json`,
        );
      }
    } else if (args[i] === '--output') {
      const value = args[i + 1];
      if (value) {
        outputPath = value;
        i++;
      } else {
        throw new Error('--output 需要指定文件路径');
      }
    } else {
      rest.push(args[i]);
    }
  }

  return { mode, format, outputPath, rest };
}

/** 解析命令行参数 */
function parseArgs(args: string[]): TravelRequest | null {
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
  // 0. 解析命令行参数，提取运行模式、输出格式、输出路径
  const rawArgs = process.argv.slice(2).filter((a) => a !== '--');
  const { mode, format, outputPath, rest } = extractOptions(rawArgs);
  setMode(mode);

  // 1. 获取用户输入
  const request = parseArgs(rest) ?? (await promptInput());

  console.log(`\n🚀 正在启动多Agent旅行规划工作流（模式：${mode}，格式：${format}）...\n`);

  // 2. 构建并执行工作流
  const app = buildTravelGraph();
  const result = await app.invoke({ request });

  // 3. 按所选格式生成输出文本
  let outputText: string;
  switch (format) {
    case 'markdown':
      outputText = formatPlanMarkdown(result);
      break;
    case 'json':
      outputText = formatPlanJson(result);
      break;
    case 'text':
    default:
      outputText = result.summary ?? '⚠️ 未能生成旅行方案';
      break;
  }

  // 4. 输出到 stdout
  console.log(outputText);

  // 5. 若指定 --output，则写入文件
  if (outputPath) {
    await writeFile(outputPath, outputText, 'utf8');
    console.log(`\n💾 方案已写入文件：${outputPath}`);
  }
}

main().catch((err) => {
  console.error('❌ 运行出错：', err);
  process.exit(1);
});
