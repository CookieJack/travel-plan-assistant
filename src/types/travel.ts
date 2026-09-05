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

/** LangGraph 全局状态 */
export interface TravelState {
  request: TravelRequest;
  flights?: FlightResult;
  hotels?: HotelResult;
  activities?: ActivitiesResult;
  budget?: BudgetResult;
  /** 主控汇总后的最终旅行方案文本 */
  summary?: string;
}
