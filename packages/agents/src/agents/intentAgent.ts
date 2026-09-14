/**
 * Intent Agent - 意图识别与信息抽取节点
 * Phase17 新增
 *
 * 职责：
 * 1. 从用户自然语言输入中抽取旅行规划所需的结构化字段
 * 2. 必填字段（destination/days/travelDate）缺失时返回追问，图中断
 * 3. 字段完整时填充 state.request，继续执行规划流程
 *
 * 模式：
 * - mock：正则/关键词规则抽取（零依赖、确定性）
 * - llm：豆包 LLM（json_object 模式）抽取 + zod 校验 + 重试
 */
import type {
  TravelState,
  TravelRequest,
  ClarificationMessage,
} from '@travel/shared';
import { intentExtractionSchema } from '@travel/shared';
import { isLLMMode, getJSONLLM } from '@travel/llm';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

/** intent 节点系统提示词（注入当前日期） */
function getIntentSystemPrompt(): string {
  const now = new Date();
  const year = now.getFullYear();
  const today = `${year}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
  const weekDay = weekDays[now.getDay()];
  return `你是旅行规划助手的意图识别与信息抽取模块。
请从用户的自然语言描述（含多轮对话上下文）中提取旅行规划所需的结构化信息。

当前日期：${today}（星期${weekDay}）

需要提取的字段：
- destination: 目的地城市（单个城市时填此字段）
- days: 出行天数（正整数）
- travelDate: 出行日期（YYYY-MM-DD 格式）
  - 相对日期需根据当前日期推算：明天=+1天，后天=+2天，大后天=+3天
  - 下周一~日 = 下周对应的星期几；本周/这周X = 本周对应的星期几
  - 节日映射：元旦→01-01，春节→02-01，清明→04-05，劳动节→05-01，端午→06-01，中秋→09-15，国庆→10-01
  - 【重要】若用户只说"周X"或"星期X"（如"周五"），必须结合上下文推断是本周还是下周：
    若对话中提到"下周"，则"周X"指下周的星期X；否则指本周的星期X。
    例如：用户先说"下周去杭州"，追问后回答"周五"，则 travelDate = 下周五的日期。
- budget_limit: 预算上限（数字，单位元，可选）
- user_preference: 用户偏好（如美食、自然风光、博物馆等，可选）
- travel_style: 出行风格（穷游/舒适/轻奢，可选）
- destinations: 多城市列表（若用户提到多个城市，填此数组，每项含 city 和 days；单城市时不填）
- clarificationQuestion: 当 destination、days、travelDate 中任一必填字段缺失时，用一句自然、口语化的中文向用户追问缺失的信息。语气要亲切自然，像朋友聊天，不要用"请补充以下信息"这种生硬句式。若所有必填字段都已提取，此字段留空不填。

要求：
- 只输出 JSON，不要任何解释或前缀
- 无法确定的字段留空字符串或不填
- 日期统一转为 YYYY-MM-DD 格式
- 若用户提到多个城市，提取到 destinations 数组
- clarificationQuestion 要口语化，例如缺日期可以说"打算什么时候出发呀？"，缺目的地可以说"这次想去哪里玩呢？"
- 务必仔细阅读完整对话上下文，不要遗漏用户在追问中补充的信息`;
}

/** LLM 抽取最大重试次数 */
const LLM_EXTRACT_MAX_RETRIES = 2;

/** 常见城市列表（用于 mock 模式目的地匹配） */
const CITY_LIST = [
  '北京', '上海', '广州', '深圳', '成都', '重庆', '杭州', '南京', '武汉', '西安',
  '长沙', '青岛', '厦门', '苏州', '天津', '郑州', '合肥', '福州', '济南', '沈阳',
  '大连', '宁波', '无锡', '昆明', '贵阳', '南昌', '哈尔滨', '长春', '石家庄', '太原',
  '兰州', '海口', '三亚', '拉萨', '乌鲁木齐', '呼和浩特', '银川', '西宁',
  '东京', '大阪', '京都', '首尔', '釜山', '曼谷', '清迈', '新加坡', '吉隆坡',
  '巴黎', '伦敦', '纽约', '洛杉矶', '旧金山', '悉尼', '墨尔本',
];

/**
 * 意图识别与信息抽取节点
 */
export async function intentAgent(state: TravelState) {
  const { request } = state;
  const naturalLanguage = request.naturalLanguage ?? '';
  const history: ClarificationMessage[] = request.clarificationHistory ?? [];

  // 无输入文本时（如服务层已预抽取字段），直接使用已有字段，不重复抽取
  if (!naturalLanguage && history.length === 0) {
    const missing: string[] = [];
    if (!request.destination) missing.push('destination');
    if (!request.days || request.days <= 0) missing.push('days');
    if (!request.travelDate) missing.push('travelDate');

    if (missing.length > 0) {
      const question = generateNaturalQuestion(missing);
      return {
        needClarification: true,
        clarificationQuestion: question,
        extractedFields: {
          destination: request.destination,
          days: request.days,
          travelDate: request.travelDate,
          budget_limit: request.budget_limit,
          user_preference: request.user_preference,
          travel_style: request.travel_style,
          destinations: request.destinations,
        },
        request,
      };
    }
    return { needClarification: false, request };
  }

  // 拼接完整对话上下文
  const fullContext = buildFullContext(naturalLanguage, history);

  // 抽取字段
  const extracted = isLLMMode()
    ? await extractWithLLM(fullContext)
    : extractWithRules(fullContext);

  // 合并：仅当抽取结果非空时覆盖已有字段
  const merged: TravelRequest = {
    destination: extracted.destination || request.destination || '',
    days: extracted.days || request.days || 0,
    travelDate: extracted.travelDate || request.travelDate || '',
    budget_limit: extracted.budget_limit ?? request.budget_limit,
    user_preference: extracted.user_preference || request.user_preference,
    travel_style: extracted.travel_style || request.travel_style,
    destinations: extracted.destinations ?? request.destinations,
  };

  // 多城市场景：LLM 按提示词会将 destination 留空、仅填 destinations。
  // 此时从 destinations 推导回填 destination/days，避免必填检查误判缺失。
  if (merged.destinations && merged.destinations.length > 0) {
    if (!merged.destination) {
      merged.destination = merged.destinations[0].city;
    }
    if (!merged.days || merged.days <= 0) {
      merged.days = merged.destinations.reduce((sum, d) => sum + d.days, 0);
    }
  }

  // 检查必填字段
  const missing: string[] = [];
  if (!merged.destination) missing.push('destination');
  if (!merged.days || merged.days <= 0) missing.push('days');
  if (!merged.travelDate) missing.push('travelDate');

  if (missing.length > 0) {
    // 优先使用 LLM 生成的自然追问，mock 模式或 LLM 未生成时用模板
    const question =
      extracted.clarificationQuestion || generateNaturalQuestion(missing);
    return {
      needClarification: true,
      clarificationQuestion: question,
      extractedFields: {
        destination: merged.destination,
        days: merged.days,
        travelDate: merged.travelDate,
        budget_limit: merged.budget_limit,
        user_preference: merged.user_preference,
        travel_style: merged.travel_style,
        destinations: merged.destinations,
      },
      request: merged,
    };
  }

  // 字段完整，继续执行规划
  return {
    needClarification: false,
    request: merged,
  };
}

/**
 * mock 模式：正则/关键词规则抽取
 */
function extractWithRules(text: string): Partial<TravelRequest> {
  const result: Partial<TravelRequest> = {};

  // 1. 多城市检测：在文本中查找所有出现的城市名（按出现顺序）
  const foundCities: string[] = [];
  // 记录每个城市在文本中的位置，用于排序
  const cityPositions: { city: string; pos: number }[] = [];
  for (const city of CITY_LIST) {
    const idx = text.indexOf(city);
    if (idx >= 0) {
      cityPositions.push({ city, pos: idx });
    }
  }
  cityPositions.sort((a, b) => a.pos - b.pos);
  for (const cp of cityPositions) {
    if (!foundCities.includes(cp.city)) {
      foundCities.push(cp.city);
    }
  }

  if (foundCities.length >= 2) {
    // 模式1：「各玩X天」「各X天」「分别X天」→ 每城相同天数
    const eachDaysMatch = text.match(/(?:各玩|各|分别)\s*(\d+)\s*天/);
    if (eachDaysMatch) {
      const perCityDays = parseInt(eachDaysMatch[1], 10);
      result.destinations = foundCities.map((city) => ({
        city,
        days: perCityDays,
      }));
    } else {
      // 模式2：「城市A玩X天...城市B玩Y天」→ 每城各自天数
      const cityDaysMap: Record<string, number> = {};
      for (const city of foundCities) {
        // 匹配「城市名...X天」（城市名后30字符内的天数）
        const cityIdx = text.indexOf(city);
        const afterCity = text.slice(cityIdx, cityIdx + 30);
        const dayMatch = afterCity.match(/(?:玩|待|停留)?\s*(\d+)\s*天/);
        if (dayMatch) {
          cityDaysMap[city] = parseInt(dayMatch[1], 10);
        }
      }
      // 所有城市都匹配到各自天数时使用
      const allHaveDays = foundCities.every((c) => cityDaysMap[c]);
      if (allHaveDays) {
        result.destinations = foundCities.map((city) => ({
          city,
          days: cityDaysMap[city],
        }));
      } else {
        // 模式3：兜底 — 总天数 / 城市数
        const totalDays = extractDays(text) || 3;
        const perCityDays = Math.max(
          Math.floor(totalDays / foundCities.length),
          1,
        );
        result.destinations = foundCities.map((city) => ({
          city,
          days: perCityDays,
        }));
      }
    }
    result.destination = foundCities[0];
  }

  // 2. 目的地：匹配城市名（单城市模式）
  if (!result.destination) {
    for (const city of CITY_LIST) {
      if (text.includes(city)) {
        result.destination = city;
        break;
      }
    }
  }

  // 3. 天数：「X天」「X日」「玩X天」「X日游」
  const days = extractDays(text);
  if (days) {
    result.days = days;
  }

  // 4. 日期：「X月X日」「X号」
  const dateMatch = text.match(/(\d{1,2})月(\d{1,2})[日号]?/);
  if (dateMatch) {
    const month = dateMatch[1].padStart(2, '0');
    const day = dateMatch[2].padStart(2, '0');
    const year = new Date().getFullYear();
    result.travelDate = `${year}-${month}-${day}`;
  }

  // 4.1 节日日期映射
  if (!result.travelDate) {
    const year = new Date().getFullYear();
    const festivalMap: Record<string, string> = {
      '元旦': `${year}-01-01`,
      '春节': `${year}-02-01`,
      '清明': `${year}-04-05`,
      '劳动节': `${year}-05-01`,
      '端午': `${year}-06-01`,
      '中秋': `${year}-09-15`,
      '国庆': `${year}-10-01`,
      '圣诞': `${year}-12-25`,
    };
    for (const [festival, date] of Object.entries(festivalMap)) {
      if (text.includes(festival)) {
        result.travelDate = date;
        break;
      }
    }
  }

  // 4.2 相对日期解析（明天/后天/下周五/本周三等）
  if (!result.travelDate) {
    const relDate = parseRelativeDate(text);
    if (relDate) {
      result.travelDate = relDate;
    }
  }

  // 5. 预算：「预算X」「X元」「X块」
  const budgetMatch = text.match(/(?:预算|花费)?\s*(\d+)\s*(?:元|块)/);
  if (budgetMatch) {
    result.budget_limit = parseInt(budgetMatch[1], 10);
  }

  // 6. 风格：穷游/舒适/轻奢
  if (text.includes('穷游')) result.travel_style = '穷游';
  else if (text.includes('舒适')) result.travel_style = '舒适';
  else if (text.includes('轻奢')) result.travel_style = '轻奢';

  // 7. 偏好：「喜欢XX」「XX控」
  const prefMatch = text.match(/喜欢([\u4e00-\u9fa5A-Za-z、，,\s]+)/);
  if (prefMatch) {
    result.user_preference = prefMatch[1].trim();
  }

  return result;
}

/** 从天数字符串中提取天数 */
function extractDays(text: string): number | undefined {
  const daysMatch = text.match(/(\d+)\s*(?:天|日)/);
  if (daysMatch) {
    return parseInt(daysMatch[1], 10);
  }
  return undefined;
}

/** 星期中文 → getDay() 数值映射 */
const WEEK_DAY_MAP: Record<string, number> = {
  '日': 0, '天': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6,
};

/** 格式化日期为 YYYY-MM-DD */
function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 解析相对日期：明天、后天、大后天、下周一~日、本周/这周X
 * 支持独立星期表达（如"周五"）结合上下文"下周/本周"推断
 * 返回 YYYY-MM-DD 格式字符串，无法解析返回 undefined
 */
function parseRelativeDate(text: string): string | undefined {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // 明天/后天/大后天
  if (text.includes('大后天')) {
    return formatDate(new Date(today.getTime() + 3 * 86400000));
  }
  if (text.includes('后天')) {
    return formatDate(new Date(today.getTime() + 2 * 86400000));
  }
  if (text.includes('明天')) {
    return formatDate(new Date(today.getTime() + 1 * 86400000));
  }

  // 下周一~日 / 本周X / 这周X（完整表达优先）
  const weekMatch = text.match(/(下|本|这)(?:周|星期)([一二三四五六日天])/);
  if (weekMatch) {
    const scope = weekMatch[1]; // 下 / 本 / 这
    const targetDay = WEEK_DAY_MAP[weekMatch[2]];
    return calcWeekdayDate(today, targetDay, scope);
  }

  // 独立星期表达：周X / 星期X（无"下/本/这"前缀）
  // 结合上下文推断 scope：若上下文中出现"下周"则为下周，否则本周
  const standaloneWeekMatch = text.match(/(?:周|星期)([一二三四五六日天])/);
  if (standaloneWeekMatch) {
    const targetDay = WEEK_DAY_MAP[standaloneWeekMatch[1]];
    const scope = text.includes('下周') ? '下' : '本';
    return calcWeekdayDate(today, targetDay, scope);
  }

  return undefined;
}

/** 计算指定 scope（下/本）的星期几对应的日期 */
function calcWeekdayDate(
  today: Date,
  targetDay: number,
  scope: '下' | '本',
): string {
  const currentDay = today.getDay();

  if (scope === '下') {
    // 下周：从下周一开始算
    const daysToNextMonday = (8 - currentDay) % 7 || 7;
    const nextMonday = new Date(today.getTime() + daysToNextMonday * 86400000);
    const offset = (targetDay - 1 + 7) % 7;
    return formatDate(new Date(nextMonday.getTime() + offset * 86400000));
  } else {
    // 本周：本周内对应星期几，已过则取下一周
    const diff = targetDay - currentDay;
    const target = new Date(today.getTime() + diff * 86400000);
    if (target < today) {
      return formatDate(new Date(target.getTime() + 7 * 86400000));
    }
    return formatDate(target);
  }
}

/**
 * llm 模式：豆包 LLM（json_object 模式）抽取 + zod 校验 + 重试
 */
async function extractWithLLM(
  text: string,
): Promise<Partial<TravelRequest>> {
  const llm = getJSONLLM();
  if (!llm) {
    console.error('[IntentAgent] LLM 未配置，无法抽取');
    return {};
  }

  const totalAttempts = LLM_EXTRACT_MAX_RETRIES + 1;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    try {
      const response = await llm.invoke([
        new SystemMessage(getIntentSystemPrompt()),
        new HumanMessage(text),
      ]);

      const content =
        typeof response.content === 'string' ? response.content : '';

      if (!content) {
        throw new Error('LLM 返回内容为空');
      }

      // 清理可能的 markdown 代码块标记
      const jsonStr = content
        .replace(/```json\s*/g, '')
        .replace(/```/g, '')
        .trim();

      const parsed = JSON.parse(jsonStr) as unknown;

      // zod 校验：字段类型/格式不通过则抛错重试
      const validated = intentExtractionSchema.parse(parsed);

      console.log(
        `[IntentAgent] LLM 抽取成功${attempt > 1 ? `（重试${attempt - 1}次）` : ''}`,
      );
      return validated;
    } catch (err) {
      lastError = err as Error;
      if (attempt < totalAttempts) {
        console.warn(
          `[IntentAgent] LLM 抽取失败（第 ${attempt}/${totalAttempts} 次）：${lastError.message}，重试中...`,
        );
      }
    }
  }

  // 重试耗尽：返回空对象，由必填字段检查触发追问
  console.error(
    `[IntentAgent] LLM 抽取重试 ${LLM_EXTRACT_MAX_RETRIES} 次后仍失败：${lastError?.message ?? '未知错误'}，返回空结果触发追问`,
  );
  return {};
}

/**
 * 根据缺失字段生成自然、口语化的追问（mock 模式使用）
 * @param missing 缺失的字段名数组（destination / days / travelDate）
 */
function generateNaturalQuestion(missing: string[]): string {
  const templates: Record<string, string[]> = {
    destination: [
      '这次想去哪里玩呀？',
      '打算去哪座城市呢？',
      '目的地定好了吗，想去哪里呀？',
      '这次旅行的目的地是哪里呢？',
    ],
    days: [
      '打算玩几天呀？',
      '计划出行几天呢？',
      '这次准备玩几天？',
      '行程安排几天比较合适？',
    ],
    travelDate: [
      '打算什么时候出发呀？',
      '计划哪天出发呢？',
      '出行日期定了吗？',
      '准备什么时候启程？',
    ],
  };

  // 随机选择模板，增加多样性
  const pick = (arr: string[]) =>
    arr[Math.floor(Math.random() * arr.length)];

  if (missing.length === 1) {
    return pick(templates[missing[0]] ?? templates.destination);
  }

  // 多个字段缺失时，组合成自然问句
  const questions = missing.map((m) => pick(templates[m] ?? templates.destination));
  return questions.join('另外，');
}

/**
 * 拼接完整对话上下文
 */
function buildFullContext(
  latest: string,
  history: ClarificationMessage[],
): string {
  if (history.length === 0) return latest;
  const parts = history.map(
    (m) => `${m.role === 'user' ? '用户' : '助手'}：${m.content}`,
  );
  parts.push(`用户：${latest}`);
  return parts.join('\n');
}
