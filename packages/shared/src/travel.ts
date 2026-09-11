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
  /** Phase15 新增：多城市目的地列表（存在且长度>1 时为多城市模式） */
  destinations?: CityDestination[];
}

/** 多城市目的地（Phase15 新增） */
export interface CityDestination {
  city: string;
  days: number;
}

/** 单个城市的规划结果（Phase15 新增） */
export interface CityPlan {
  city: string;
  days: number;
  flights?: FlightResult;
  hotels?: HotelResult;
  activities?: ActivitiesResult;
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
  /** Phase15 新增：多城市规划结果（单城市模式下为 undefined） */
  cityPlans?: CityPlan[];
}

// ============================================================
// Phase13：LLM 输出校验改用 zod 实现
// 以下函数签名与原手写版本一致，内部实现由 schemas/agentOutput.ts 提供
// ============================================================

export {
  validateFlightOutput,
  validateHotelOutput,
  validateActivitiesOutput,
  validateBudgetOutput,
} from './schemas/agentOutput.js';
