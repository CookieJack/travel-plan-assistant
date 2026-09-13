/**
 * 旅行规划服务
 * 封装 Agent 调用，处理 mode/format，不修改 Agent 内部逻辑
 */
import { buildTravelGraph, budgetingAgent, supervisorAgent, intentAgent } from '@travel/agents';
import { setMode } from '@travel/llm';
import {
  formatPlanMarkdown,
  type TravelRequest,
  type TravelState,
  type CityPlan,
} from '@travel/shared';
import type { OutputFormat, RunMode } from '../types/api.js';
import { savePlan, getPlanById, getUserById, type SavePlanMeta } from './dbService.js';
import {
  createConversation,
  addMessage,
  attachPlanToConversation,
} from './conversationService.js';
import {
  cacheGet,
  cacheSet,
  planResultKey,
  cacheDelByPattern,
} from './cacheService.js';

/** 规划结果缓存 TTL（秒） */
const PLAN_RESULT_TTL: Record<RunMode, number> = {
  mock: 3600, // 1 小时
  llm: 1800, // 30 分钟
};

/** 持久化元信息 */
interface PersistMeta {
  id: string;
  createdAt: string;
}

/**
 * SSE 流式事件（Phase11 新增）
 */
export type SSEEvent =
  | { type: 'start'; data: { message: string } }
  | { type: 'node_complete'; data: { node: string; toolCalls?: TravelState['toolCalls'] } }
  | { type: 'cache_hit'; data: { result: TravelState & PersistMeta; conversationId: string } }
  | { type: 'complete'; data: { result: TravelState & PersistMeta; conversationId: string } }
  | { type: 'clarification'; data: { question: string; extractedFields: Partial<TravelRequest>; conversationId: string } }
  | { type: 'error'; data: { message: string } };

/**
 * 持久化规划结果到数据库（Phase11 抽取：供 generatePlan 与 generatePlanStream 共用）
 * Phase14 扩展：支持传入 parentId/feedback 记录修订关系
 */
async function persistPlan(
  state: TravelState,
  mode: RunMode,
  meta?: SavePlanMeta,
): Promise<PersistMeta> {
  let persistMeta: PersistMeta = { id: '', createdAt: new Date().toISOString() };
  try {
    const saved = await savePlan(state, mode, meta);
    persistMeta = { id: saved.id, createdAt: saved.createdAt.toISOString() };
  } catch (err) {
    console.error('[TravelService] 持久化规划结果失败：', (err as Error).message);
  }
  return persistMeta;
}

/**
 * Phase16 新增：将用户默认偏好带入请求
 * 用户显式传入的字段优先级更高（不覆盖）
 */
async function applyUserPreferences(
  request: TravelRequest,
  userId: string | undefined,
): Promise<void> {
  if (!userId) return;
  const user = await getUserById(userId);
  if (!user) return;
  if (user.defaultStyle && !request.travel_style) {
    request.travel_style = user.defaultStyle;
  }
  if (user.defaultBudget != null && request.budget_limit == null) {
    request.budget_limit = user.defaultBudget;
  }
  if (user.defaultPreference && !request.user_preference) {
    request.user_preference = user.defaultPreference;
  }
}

/**
 * 执行旅行规划并持久化结果
 * @param request 用户旅行需求
 * @param mode 运行模式 mock | llm
 * @param format 输出格式 text | markdown | json
 * @returns 规划结果 + 持久化元信息（id/createdAt）
 */
export async function generatePlan(
  request: TravelRequest,
  mode: RunMode = 'mock',
  format: OutputFormat = 'json',
  persistMeta?: SavePlanMeta,
): Promise<
  | (TravelState & PersistMeta)
  | ({ format: OutputFormat; content: string } & PersistMeta)
> {
  // 设置运行模式
  setMode(mode);

  // Phase16：带入用户默认偏好（用户显式传参优先级更高）
  await applyUserPreferences(request, persistMeta?.userId);

  // Phase18：确保会话存在并保存用户消息
  let conversationId = request.conversationId;
  if (!conversationId && request.naturalLanguage) {
    const conv = await createConversation(
      persistMeta?.userId,
      request.naturalLanguage,
    );
    conversationId = conv.id;
  }
  if (conversationId && request.naturalLanguage) {
    await addMessage({
      conversationId,
      role: 'user',
      content: request.naturalLanguage,
      type: 'text',
    });
  }

  // Phase17：自然语言输入时，先调用 intent_agent 抽取结构化字段
  let activeRequest = request;
  if (request.naturalLanguage) {
    const intentResult = await intentAgent({ request });
    if (intentResult.needClarification) {
      // Phase18：保存助手追问消息
      if (conversationId) {
        await addMessage({
          conversationId,
          role: 'assistant',
          content: intentResult.clarificationQuestion ?? '请补充旅行信息',
          type: 'clarification',
          data: intentResult.extractedFields,
        });
      }
      // 追问场景：不缓存、不持久化，直接返回追问信息
      return {
        ...intentResult,
        id: '',
        createdAt: new Date().toISOString(),
        conversationId,
      } as TravelState & PersistMeta & { conversationId?: string };
    }
    // 用抽取后的字段更新 request，清除 naturalLanguage 避免图中重复抽取
    activeRequest = { ...intentResult.request };
    activeRequest.naturalLanguage = undefined;
    activeRequest.clarificationHistory = undefined;
  }

  // 计算规划结果缓存键
  const cacheKey = planResultKey(activeRequest, mode);

  // 查询缓存：命中则跳过 Agent 执行
  let result: TravelState | null = await cacheGet<TravelState>(cacheKey);
  if (result) {
    console.log('[TravelService] 规划结果命中缓存，跳过 Agent 执行');
  } else {
    // 未命中：判断单城市 / 多城市
    const destinations = activeRequest.destinations;
    const isMultiCity = destinations && destinations.length > 1;

    if (isMultiCity) {
      result = await generateMultiCityPlan(activeRequest);
    } else {
      // 单城市：构建并执行工作流（原有逻辑）
      const app = buildTravelGraph();
      result = await app.invoke({ request: activeRequest });
    }
    // 写入缓存（失败仅记日志，不阻断）
    await cacheSet(cacheKey, result, PLAN_RESULT_TTL[mode]);
  }

  // 持久化到数据库（失败不阻断，仅记日志）
  const meta = await persistPlan(result, mode, persistMeta);

  // Phase18：保存助手结果消息并关联 planId 到会话
  if (conversationId) {
    await addMessage({
      conversationId,
      role: 'assistant',
      content: '已为您生成旅行规划方案：',
      type: 'plan_result',
      planId: meta.id,
    });
    await attachPlanToConversation(conversationId, meta.id);
  }

  // 新规划生成后，清理历史列表缓存（保证列表能看到新记录）
  await cacheDelByPattern('plan:list:*');

  // 根据格式返回结果
  switch (format) {
    case 'text':
      return {
        format: 'text',
        content: result.summary ?? '⚠️ 未能生成旅行方案',
        ...meta,
      };
    case 'markdown':
      return {
        format: 'markdown',
        content: formatPlanMarkdown(result),
        ...meta,
      };
    case 'json':
    default:
      return {
        ...result,
        ...meta,
      };
  }
}

/**
 * Phase15 新增：多城市规划执行（非流式）
 * 循环调用单城市图，汇总后统一调用 budgeting + supervisor
 */
async function generateMultiCityPlan(request: TravelRequest): Promise<TravelState> {
  const cityPlans: CityPlan[] = [];
  const allToolCalls: TravelState['toolCalls'] = [];

  for (const dest of request.destinations!) {
    // 构造单城市 request（复用现有图）
    const cityRequest: TravelRequest = {
      destination: dest.city,
      days: dest.days,
      travelDate: request.travelDate,
      user_preference: request.user_preference,
      budget_limit: request.budget_limit,
      travel_style: request.travel_style,
    };

    // 调用完整图（flight/hotel/activities/budgeting/supervisor）
    const app = buildTravelGraph();
    const cityState = await app.invoke({ request: cityRequest });

    cityPlans.push({
      city: dest.city,
      days: dest.days,
      flights: cityState.flights,
      hotels: cityState.hotels,
      activities: cityState.activities,
    });

    if (cityState.toolCalls) {
      allToolCalls.push(...cityState.toolCalls);
    }
  }

  // 构造汇总 state
  const mergedState: TravelState = {
    request,
    cityPlans,
    // 兼容单城市字段：取第一个城市
    flights: cityPlans[0]?.flights,
    hotels: cityPlans[0]?.hotels,
    activities: cityPlans[0]?.activities,
    toolCalls: allToolCalls,
  };

  // 调用 budgeting 汇总（多城市逻辑）
  const budgetResult = await budgetingAgent(mergedState);
  mergedState.budget = budgetResult.budget;

  // 调用 supervisor 汇总（多城市逻辑）
  const supervisorResult = await supervisorAgent(mergedState);
  mergedState.summary = supervisorResult.summary;

  return mergedState;
}

/**
 * 流式执行旅行规划，通过异步生成器逐事件产出（Phase11 新增）
 * 事件顺序：cache_hit（命中缓存）/ start → node_complete（每个节点）→ complete
 * @param request 用户旅行需求
 * @param mode 运行模式 mock | llm
 */
export async function* generatePlanStream(
  request: TravelRequest,
  mode: RunMode = 'mock',
  persistMeta?: SavePlanMeta,
): AsyncGenerator<SSEEvent> {
  // 设置运行模式
  setMode(mode);

  // Phase16：带入用户默认偏好（用户显式传参优先级更高）
  await applyUserPreferences(request, persistMeta?.userId);

  // Phase18：确保会话存在并保存用户消息
  let conversationId = request.conversationId;
  if (!conversationId && request.naturalLanguage) {
    const conv = await createConversation(
      persistMeta?.userId,
      request.naturalLanguage,
    );
    conversationId = conv.id;
  }
  if (conversationId && request.naturalLanguage) {
    await addMessage({
      conversationId,
      role: 'user',
      content: request.naturalLanguage,
      type: 'text',
    });
  }

  // Phase17：自然语言输入时，先调用 intent_agent 抽取结构化字段
  let activeRequest = request;
  if (request.naturalLanguage) {
    const intentResult = await intentAgent({ request });
    if (intentResult.needClarification) {
      // Phase18：保存助手追问消息
      if (conversationId) {
        await addMessage({
          conversationId,
          role: 'assistant',
          content: intentResult.clarificationQuestion ?? '请补充旅行信息',
          type: 'clarification',
          data: intentResult.extractedFields,
        });
      }
      // 追问场景：发送 clarification 事件后结束
      yield {
        type: 'clarification',
        data: {
          question: intentResult.clarificationQuestion ?? '请补充旅行信息',
          extractedFields: intentResult.extractedFields ?? {},
          conversationId: conversationId ?? '',
        },
      };
      return;
    }
    // 用抽取后的字段更新 request，清除 naturalLanguage 避免图中重复抽取
    activeRequest = { ...intentResult.request };
    activeRequest.naturalLanguage = undefined;
    activeRequest.clarificationHistory = undefined;
  }

  // 计算规划结果缓存键
  const cacheKey = planResultKey(activeRequest, mode);

  // 查询缓存：命中则直接返回完整结果
  const cached = await cacheGet<TravelState>(cacheKey);
  if (cached) {
    console.log('[TravelService] 规划结果命中缓存，跳过 Agent 执行');
    const meta = await persistPlan(cached, mode, persistMeta);
    // Phase18：保存助手结果消息并关联 planId
    if (conversationId) {
      await addMessage({
        conversationId,
        role: 'assistant',
        content: '已为您生成旅行规划方案：',
        type: 'plan_result',
        planId: meta.id,
      });
      await attachPlanToConversation(conversationId, meta.id);
    }
    await cacheDelByPattern('plan:list:*');
    yield {
      type: 'cache_hit',
      data: { result: { ...cached, ...meta }, conversationId: conversationId ?? '' },
    };
    return;
  }

  // 未命中：发送开始事件
  yield { type: 'start', data: { message: '开始生成旅行规划...' } };

  const destinations = activeRequest.destinations;
  const isMultiCity = destinations && destinations.length > 1;

  if (isMultiCity) {
    // Phase15 多城市流式规划
    const cityPlans: CityPlan[] = [];
    const allToolCalls: TravelState['toolCalls'] = [];
    let finalState: TravelState = { request: activeRequest };

    for (const dest of destinations!) {
      const cityRequest: TravelRequest = {
        destination: dest.city,
        days: dest.days,
        travelDate: activeRequest.travelDate,
        user_preference: activeRequest.user_preference,
        budget_limit: activeRequest.budget_limit,
        travel_style: activeRequest.travel_style,
      };

      const app = buildTravelGraph();
      let cityState: TravelState = { request: cityRequest };
      const stream = await app.stream({ request: cityRequest }, { streamMode: 'updates' });
      for await (const chunk of stream) {
        for (const [nodeName, update] of Object.entries(chunk)) {
          const nodeUpdate = update as Partial<TravelState>;
          const mergedToolCalls = nodeUpdate.toolCalls
            ? [...(cityState.toolCalls ?? []), ...nodeUpdate.toolCalls]
            : cityState.toolCalls;
          cityState = { ...cityState, ...nodeUpdate, toolCalls: mergedToolCalls };
          yield {
            type: 'node_complete',
            data: {
              node: `${dest.city}:${nodeName}`,
              toolCalls: nodeUpdate.toolCalls,
            },
          };
        }
      }

      cityPlans.push({
        city: dest.city,
        days: dest.days,
        flights: cityState.flights,
        hotels: cityState.hotels,
        activities: cityState.activities,
      });
      if (cityState.toolCalls) {
        allToolCalls.push(...cityState.toolCalls);
      }
    }

    finalState = {
      request: activeRequest,
      cityPlans,
      flights: cityPlans[0]?.flights,
      hotels: cityPlans[0]?.hotels,
      activities: cityPlans[0]?.activities,
      toolCalls: allToolCalls,
    };

    // 多城市预算汇总
    const budgetResult = await budgetingAgent(finalState);
    finalState.budget = budgetResult.budget;
    yield { type: 'node_complete', data: { node: 'budgeting' } };

    // 多城市主控汇总
    const supervisorResult = await supervisorAgent(finalState);
    finalState.summary = supervisorResult.summary;
    yield { type: 'node_complete', data: { node: 'supervisor' } };

    await cacheSet(cacheKey, finalState, PLAN_RESULT_TTL[mode]);
    const meta = await persistPlan(finalState, mode, persistMeta);
    // Phase18：保存助手结果消息并关联 planId
    if (conversationId) {
      await addMessage({
        conversationId,
        role: 'assistant',
        content: '已为您生成旅行规划方案：',
        type: 'plan_result',
        planId: meta.id,
      });
      await attachPlanToConversation(conversationId, meta.id);
    }
    await cacheDelByPattern('plan:list:*');
    yield {
      type: 'complete',
      data: { result: { ...finalState, ...meta }, conversationId: conversationId ?? '' },
    };
    return;
  }

  // 单城市：构建并流式执行工作流
  const app = buildTravelGraph();
  let finalState: TravelState = { request: activeRequest };

  const stream = await app.stream({ request: activeRequest }, { streamMode: 'updates' });
  for await (const chunk of stream) {
    for (const [nodeName, update] of Object.entries(chunk)) {
      const nodeUpdate = update as Partial<TravelState>;
      // toolCalls 使用追加合并（与 buildGraph 的 Annotation reducer 一致）
      // Phase12：多个 Agent 并行写入 toolCalls，需追加而非覆盖
      const mergedToolCalls = nodeUpdate.toolCalls
        ? [...(finalState.toolCalls ?? []), ...nodeUpdate.toolCalls]
        : finalState.toolCalls;
      finalState = { ...finalState, ...nodeUpdate, toolCalls: mergedToolCalls };
      // 发送节点完成事件（携带该节点产出的 toolCalls）
      yield {
        type: 'node_complete',
        data: {
          node: nodeName,
          toolCalls: nodeUpdate.toolCalls,
        },
      };
    }
  }

  // 写入缓存（失败仅记日志，不阻断）
  await cacheSet(cacheKey, finalState, PLAN_RESULT_TTL[mode]);

  // 持久化 + 清理列表缓存
  const meta = await persistPlan(finalState, mode, persistMeta);
  // Phase18：保存助手结果消息并关联 planId
  if (conversationId) {
    await addMessage({
      conversationId,
      role: 'assistant',
      content: '已为您生成旅行规划方案：',
      type: 'plan_result',
      planId: meta.id,
    });
    await attachPlanToConversation(conversationId, meta.id);
  }
  await cacheDelByPattern('plan:list:*');

  // 发送完成事件
  yield {
    type: 'complete',
    data: { result: { ...finalState, ...meta }, conversationId: conversationId ?? '' },
  };
}

// ============================================================
// Phase14：规划修订（用户反馈 → 重新生成规划）
// ============================================================

/**
 * 基于用户反馈修订规划（非流式）
 * 将反馈追加到 request.user_preference，重新调用完整规划流程
 */
export async function revisePlan(
  planId: string,
  feedback: string,
  mode?: RunMode,
  persistMeta?: SavePlanMeta,
): Promise<TravelState & PersistMeta> {
  // 1. 查询原规划
  const original = await getPlanById(planId);
  if (!original) {
    throw new Error(`规划不存在：${planId}`);
  }

  // 2. 重组 request
  const request: TravelRequest = {
    destination: original.destination,
    days: original.days,
    travelDate: original.travelDate,
  };
  if (original.userPreference) request.user_preference = original.userPreference;
  if (original.budgetLimit !== null && original.budgetLimit !== undefined) {
    request.budget_limit = original.budgetLimit;
  }
  if (original.travelStyle) request.travel_style = original.travelStyle;

  // 3. 将反馈追加到 user_preference
  const basePreference = request.user_preference ?? '';
  request.user_preference = basePreference
    ? `${basePreference}\n\n用户反馈：${feedback}`
    : `用户反馈：${feedback}`;

  // 4. 确定运行模式
  const runMode: RunMode = mode ?? (original.mode === 'llm' ? 'llm' : 'mock');

  // 5. 调用现有 generatePlan
  const result = await generatePlan(request, runMode, 'json', {
    parentId: planId,
    feedback,
    userId: persistMeta?.userId,
  });

  return result as TravelState & PersistMeta;
}

/**
 * 基于用户反馈修订规划（流式）
 * 逻辑与 revisePlan 相同，复用 generatePlanStream
 */
export async function* revisePlanStream(
  planId: string,
  feedback: string,
  mode?: RunMode,
  persistMeta?: SavePlanMeta,
): AsyncGenerator<SSEEvent> {
  // 1. 查询原规划
  const original = await getPlanById(planId);
  if (!original) {
    yield { type: 'error', data: { message: `规划不存在：${planId}` } };
    return;
  }

  // 2. 重组 request
  const request: TravelRequest = {
    destination: original.destination,
    days: original.days,
    travelDate: original.travelDate,
  };
  if (original.userPreference) request.user_preference = original.userPreference;
  if (original.budgetLimit !== null && original.budgetLimit !== undefined) {
    request.budget_limit = original.budgetLimit;
  }
  if (original.travelStyle) request.travel_style = original.travelStyle;

  // 3. 将反馈追加到 user_preference
  const basePreference = request.user_preference ?? '';
  request.user_preference = basePreference
    ? `${basePreference}\n\n用户反馈：${feedback}`
    : `用户反馈：${feedback}`;

  // 4. 确定运行模式
  const runMode: RunMode = mode ?? (original.mode === 'llm' ? 'llm' : 'mock');

  // 5. 调用现有 generatePlanStream
  yield* generatePlanStream(request, runMode, {
    parentId: planId,
    feedback,
    userId: persistMeta?.userId,
  });
}
