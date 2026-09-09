/**
 * 旅行助手共享类型定义
 * 所有 Agent 的输入输出严格遵循此处定义，保证数据标准化
 */

/** 用户旅行需求（CLI 输入） */
export interface TravelRequest {
  /** 目的地 */
  destination: string;
  /** 出行天数 */
  days: number;
  /** 出行时间（YYYY-MM-DD） */
  travelDate: string;
  /** 用户偏好（美食/自然风光/博物馆/亲子等） */
  user_preference?: string;
  /** 用户设置的预算上限 */
  budget_limit?: number;
  /** 出行风格（穷游/舒适/轻奢） */
  travel_style?: string;
}

/** 单个机票方案 */
export interface FlightOption {
  airline: string;
  flightNo: string;
  departTime: string;
  arriveTime: string;
  price: number;
  cabin: string;
}

/** 机票 Agent 输出 */
export interface FlightResult {
  agent: 'FlightSearchAgent';
  options: FlightOption[];
}

/** 单个酒店方案 */
export interface HotelOption {
  name: string;
  star: number;
  roomType: string;
  pricePerNight: number;
  location: string;
}

/** 酒店 Agent 输出 */
export interface HotelResult {
  agent: 'HotelBookingAgent';
  options: HotelOption[];
}

/** 单个活动项 */
export interface ActivityItem {
  time: string;
  name: string;
  description: string;
  cost: number;
}

/** 单日行程 */
export interface DayItinerary {
  day: number;
  activities: ActivityItem[];
}

/** 游玩活动 Agent 输出 */
export interface ActivitiesResult {
  agent: 'ActivitiesAgent';
  itinerary: DayItinerary[];
}

/** 费用明细项 */
export interface CostItem {
  category: string;
  description: string;
  amount: number;
}

/** 预算 Agent 输出 */
export interface BudgetResult {
  agent: 'BudgetingAgent';
  total: number;
  breakdown: CostItem[];
  /** 是否超出用户预算上限 */
  overBudget: boolean;
  /** 预算告警提示（超支时存在） */
  warning?: string;
  /** 超支调整建议（超支时存在） */
  suggestions?: string[];
}

/**
 * 工具调用记录（Phase10 新增）
 * 记录 Agent 调用工具的过程，供执行过程可视化使用
 */
export interface ToolCallRecord {
  /** 调用工具的 Agent 名称 */
  agent: string;
  /** 工具名称 */
  toolName: string;
  /** 工具调用参数 */
  args: Record<string, unknown>;
  /** 工具返回结果摘要（截断后的字符串，避免状态过大） */
  resultSummary: string;
  /** 调用时间戳（ISO 字符串） */
  timestamp: string;
  /** 调用模式：mock（固定逻辑调用）/ llm（LLM 决策调用） */
  mode: 'mock' | 'llm';
}

/** LangGraph 全局状态 */
export interface TravelState {
  request: TravelRequest;
  flights?: FlightResult;
  hotels?: HotelResult;
  activities?: ActivitiesResult;
  budget?: BudgetResult;
  /** 主控汇总后的最终旅行方案文本 */
  summary?: string;
  /** 工具调用记录（Phase10 新增，供可视化使用） */
  toolCalls?: ToolCallRecord[];
}

// ============================================================
// Phase3 新增：LLM 输出结构类型守卫（零依赖手写校验）
// 仅校验字段存在性与基础类型，不做业务规则校验
// ============================================================

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && !Number.isNaN(v);
}

/** 校验单个机票方案 */
function isFlightOption(v: unknown): v is FlightOption {
  if (!isObject(v)) return false;
  return (
    isString(v.airline) &&
    isString(v.flightNo) &&
    isString(v.departTime) &&
    isString(v.arriveTime) &&
    isNumber(v.price) &&
    isString(v.cabin)
  );
}

/** 校验机票 Agent 的 LLM 原始输出 */
export function validateFlightOutput(
  data: unknown,
): data is { options: FlightOption[] } {
  if (!isObject(data)) return false;
  if (!Array.isArray(data.options)) return false;
  return data.options.every(isFlightOption);
}

/** 校验单个酒店方案 */
function isHotelOption(v: unknown): v is HotelOption {
  if (!isObject(v)) return false;
  return (
    isString(v.name) &&
    isNumber(v.star) &&
    isString(v.roomType) &&
    isNumber(v.pricePerNight) &&
    isString(v.location)
  );
}

/** 校验酒店 Agent 的 LLM 原始输出 */
export function validateHotelOutput(
  data: unknown,
): data is { options: HotelOption[] } {
  if (!isObject(data)) return false;
  if (!Array.isArray(data.options)) return false;
  return data.options.every(isHotelOption);
}

/** 校验单个活动项 */
function isActivityItem(v: unknown): v is ActivityItem {
  if (!isObject(v)) return false;
  return (
    isString(v.time) &&
    isString(v.name) &&
    isString(v.description) &&
    isNumber(v.cost)
  );
}

/** 校验单日行程 */
function isDayItinerary(v: unknown): v is DayItinerary {
  if (!isObject(v)) return false;
  if (!isNumber(v.day) || !Array.isArray(v.activities)) return false;
  return v.activities.every(isActivityItem);
}

/** 校验活动 Agent 的 LLM 原始输出 */
export function validateActivitiesOutput(
  data: unknown,
): data is { itinerary: DayItinerary[] } {
  if (!isObject(data)) return false;
  if (!Array.isArray(data.itinerary)) return false;
  return data.itinerary.every(isDayItinerary);
}

/** 校验费用明细项 */
function isCostItem(v: unknown): v is CostItem {
  if (!isObject(v)) return false;
  return isString(v.category) && isString(v.description) && isNumber(v.amount);
}

/** 校验预算 Agent 的 LLM 原始输出（不含 agent 字段，由代码补充） */
export function validateBudgetOutput(
  data: unknown,
): data is {
  total: number;
  breakdown: CostItem[];
  overBudget: boolean;
  warning?: string | null;
  suggestions?: string[] | null;
} {
  if (!isObject(data)) return false;
  if (!isNumber(data.total)) return false;
  if (!Array.isArray(data.breakdown) || !data.breakdown.every(isCostItem))
    return false;
  if (typeof data.overBudget !== 'boolean') return false;
  if (data.warning !== undefined && data.warning !== null && !isString(data.warning))
    return false;
  if (
    data.suggestions !== undefined &&
    data.suggestions !== null &&
    (!Array.isArray(data.suggestions) || !data.suggestions.every(isString))
  )
    return false;
  return true;
}
