/**
 * LangGraph 工作流构建
 * 固定调度逻辑（严格遵循Spec，禁止改动）：
 *   START → 并行(flight, hotel, activities) → budgeting → supervisor → END
 *
 * 1主控 + 4子Agent，无跨角色乱调度
 */
import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import type {
  TravelState,
  TravelRequest,
  FlightResult,
  HotelResult,
  ActivitiesResult,
  BudgetResult,
} from '@travel/shared';
import { flightAgent } from '../agents/flightAgent.js';
import { hotelAgent } from '../agents/hotelAgent.js';
import { activitiesAgent } from '../agents/activitiesAgent.js';
import { budgetingAgent } from '../agents/budgetingAgent.js';
import { supervisorAgent } from '../agents/supervisor.js';

/** LangGraph 状态注解 */
const StateAnnotation = Annotation.Root({
  request: Annotation<TravelRequest>(),
  flights: Annotation<FlightResult | undefined>(),
  hotels: Annotation<HotelResult | undefined>(),
  activities: Annotation<ActivitiesResult | undefined>(),
  budget: Annotation<BudgetResult | undefined>(),
  summary: Annotation<string | undefined>(),
});

/**
 * 构建并编译旅行规划工作流
 */
export function buildTravelGraph() {
  const graph = new StateGraph(StateAnnotation)
    // 4个子Agent节点（节点名加_agent后缀，避免与状态字段同名冲突）
    .addNode('flight_agent', flightAgent)
    .addNode('hotel_agent', hotelAgent)
    .addNode('activities_agent', activitiesAgent)
    .addNode('budgeting_agent', budgetingAgent)
    // 主控汇总节点
    .addNode('supervisor_agent', supervisorAgent)

    // 从START并行分发到机票、酒店、活动三个Agent
    .addEdge(START, 'flight_agent')
    .addEdge(START, 'hotel_agent')
    .addEdge(START, 'activities_agent')

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
