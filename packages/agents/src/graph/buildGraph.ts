/**
 * LangGraph 工作流构建
 * Phase17 调整后拓扑：
 *   START → intent_agent → (条件路由)
 *     - needClarification → END
 *     - 否则 → 并行(flight, hotel, activities) → budgeting → supervisor → END
 *
 * 1主控 + 4子Agent + 1意图识别前置节点，无跨角色乱调度
 */
import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import type {
  TravelState,
  TravelRequest,
  FlightResult,
  HotelResult,
  ActivitiesResult,
  BudgetResult,
  ToolCallRecord,
} from '@travel/shared';
import { flightAgent } from '../agents/flightAgent.js';
import { hotelAgent } from '../agents/hotelAgent.js';
import { activitiesAgent } from '../agents/activitiesAgent.js';
import { budgetingAgent } from '../agents/budgetingAgent.js';
import { supervisorAgent } from '../agents/supervisor.js';
import { intentAgent } from '../agents/intentAgent.js';

/** LangGraph 状态注解 */
const StateAnnotation = Annotation.Root({
  request: Annotation<TravelRequest>(),
  flights: Annotation<FlightResult | undefined>(),
  hotels: Annotation<HotelResult | undefined>(),
  activities: Annotation<ActivitiesResult | undefined>(),
  budget: Annotation<BudgetResult | undefined>(),
  summary: Annotation<string | undefined>(),
  // Phase10 新增：工具调用记录
  // Phase12 改为 reducer 合并：flight/hotel/activities 三个 Agent 并行写入，需追加而非覆盖
  toolCalls: Annotation<ToolCallRecord[] | undefined>({
    reducer: (left, right) => [...(left ?? []), ...(right ?? [])],
  }),
  // Phase17 新增：意图识别与追问相关字段
  needClarification: Annotation<boolean | undefined>(),
  clarificationQuestion: Annotation<string | undefined>(),
  extractedFields: Annotation<Partial<TravelRequest> | undefined>(),
});

/**
 * 构建并编译旅行规划工作流
 */
export function buildTravelGraph() {
  const graph = new StateGraph(StateAnnotation)
    // Phase17 新增：意图识别与信息抽取前置节点
    .addNode('intent_agent', intentAgent)
    // 4个子Agent节点（节点名加_agent后缀，避免与状态字段同名冲突）
    .addNode('flight_agent', flightAgent)
    .addNode('hotel_agent', hotelAgent)
    .addNode('activities_agent', activitiesAgent)
    .addNode('budgeting_agent', budgetingAgent)
    // 主控汇总节点
    .addNode('supervisor_agent', supervisorAgent)

    // START → intent_agent
    .addEdge(START, 'intent_agent')

    // intent_agent → 条件路由
    // - needClarification: 直接 END（图中断，前端展示追问）
    // - 否则：并行进入三个子 Agent
    .addConditionalEdges('intent_agent', (state: TravelState) => {
      if (state.needClarification) return END;
      return ['flight_agent', 'hotel_agent', 'activities_agent'];
    })

    // 三个Agent全部完成后，进入预算Agent（依赖三者结果）
    .addEdge(['flight_agent', 'hotel_agent', 'activities_agent'], 'budgeting_agent')

    // 预算完成后，主控汇总
    .addEdge('budgeting_agent', 'supervisor_agent')

    // 汇总结束
    .addEdge('supervisor_agent', END);

  return graph.compile();
}

/** 工作流输入类型 */
export type GraphInput = Pick<TravelState, 'request'>;
