import { useState, useRef, useEffect, useCallback } from 'react';
import type { TravelRequest, ToolCallRecord } from '@travel/shared';
import { ChatPanel, type ChatMessage } from '@/components/ChatPanel';
import { PlanResult } from '@/components/PlanResult';
import { ExecutionProgress } from '@/components/ExecutionProgress';
import { SessionList } from '@/components/SessionList';
import {
  generatePlanStream,
  revisePlanStream,
  listConversations,
  getConversation,
  deleteConversation,
  getPlanById,
  type JsonPlanResponse,
  type RunMode,
  type ClarificationResult,
  type ConversationItem,
} from '@/api/client';

/**
 * 规划页：自然语言对话式旅行规划
 * Phase17 重构：移除结构化表单，改为对话输入
 * Phase18 重构：三栏布局（左会话列表、中聊天框、右执行输出）+ 会话持久化
 */
export function PlanPage() {
  // 对话消息
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // 运行模式
  const [mode, setMode] = useState<RunMode>('mock');
  // 加载状态
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // 执行进度（排除 intent_agent，仅显示实际规划节点）
  const [completedNodes, setCompletedNodes] = useState<string[]>([]);
  const [streamToolCalls, setStreamToolCalls] = useState<ToolCallRecord[]>([]);
  // 是否进入实际规划阶段（收到非 intent_agent 节点后为 true）
  const [planningStarted, setPlanningStarted] = useState(false);
  // 追问状态：已抽取的字段 + 对话历史
  const [pendingFields, setPendingFields] = useState<Partial<TravelRequest>>({});
  const [clarificationHistory, setClarificationHistory] = useState<
    { role: 'user' | 'assistant'; content: string }[]
  >([]);
  // 规划结果
  const [result, setResult] = useState<JsonPlanResponse | null>(null);
  // 请求取消控制器（支持中途改计划）
  const abortControllerRef = useRef<AbortController | null>(null);

  // Phase14 修订状态
  const [originalResult, setOriginalResult] = useState<JsonPlanResponse | null>(null);
  const [isRevised, setIsRevised] = useState(false);
  const [revising, setRevising] = useState(false);
  const [reviseNodes, setReviseNodes] = useState<string[]>([]);
  const [reviseToolCalls, setReviseToolCalls] = useState<ToolCallRecord[]>([]);

  // Phase18 新增：会话状态
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  /** 加载会话列表 */
  const loadConversations = useCallback(async () => {
    try {
      const { items } = await listConversations();
      setConversations(items);
    } catch {
      // 静默失败，不影响主流程
    }
  }, []);

  // 进入页面时加载会话列表
  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  /** Phase18：新建会话 —— 清空当前状态 */
  const handleNewSession = () => {
    // 若有进行中的请求，先取消
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setActiveConversationId(null);
    setMessages([]);
    setResult(null);
    setOriginalResult(null);
    setIsRevised(false);
    setPendingFields({});
    setClarificationHistory([]);
    setCompletedNodes([]);
    setStreamToolCalls([]);
    setPlanningStarted(false);
    setLoading(false);
    setError('');
  };

  /** Phase18：切换会话 —— 恢复消息历史与规划结果 */
  const handleSelectSession = async (id: string) => {
    // 若有进行中的请求，先取消
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setLoading(false);
    }
    setActiveConversationId(id);
    setError('');
    setResult(null);
    setPlanningStarted(false);
    setCompletedNodes([]);
    setStreamToolCalls([]);

    try {
      const conv = await getConversation(id);

      // 转换后端消息为前端 ChatMessage
      const chatMessages: ChatMessage[] = conv.messages.map((m) => {
        if (m.type === 'plan_result') {
          return {
            role: 'assistant',
            content: m.content,
            planId: m.planId ?? undefined,
          };
        }
        return { role: m.role as 'user' | 'assistant', content: m.content };
      });
      setMessages(chatMessages);

      // 恢复追问状态：若最后一条助手消息是 clarification，恢复 extractedFields
      const lastMsg = conv.messages[conv.messages.length - 1];
      if (lastMsg && lastMsg.type === 'clarification' && lastMsg.data) {
        setPendingFields(lastMsg.data as Partial<TravelRequest>);
        // 重建对话历史
        const history = conv.messages
          .filter((m) => m.type !== 'plan_result')
          .map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          }));
        setClarificationHistory(history);
      } else {
        setPendingFields({});
        setClarificationHistory([]);
      }

      // 若会话有关联规划，加载规划结果
      if (conv.planId) {
        try {
          const plan = await getPlanById(conv.planId);
          setResult(plan);
          setOriginalResult(plan);
        } catch {
          // 规划加载失败不影响消息展示
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载会话失败');
    }
  };

  /** Phase18：删除会话 */
  const handleDeleteSession = async (id: string) => {
    try {
      await deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      // 若删除的是当前会话，清空状态
      if (activeConversationId === id) {
        handleNewSession();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除会话失败');
    }
  };

  /** 取消当前生成 */
  const handleCancel = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setLoading(false);
    setPlanningStarted(false);
  };

  /** 发送用户消息 */
  const handleSend = async (text: string) => {
    // 若已有进行中的请求，先取消（用户中途改计划）
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError('');
    setResult(null);
    setCompletedNodes([]);
    setStreamToolCalls([]);
    setPlanningStarted(false);

    // 添加用户消息
    setMessages((prev) => [...prev, { role: 'user', content: text }]);

    try {
      // 构造请求：自然语言 + 对话历史 + 已抽取字段 + 会话 ID
      const fields = pendingFields ?? {};
      const request: TravelRequest = {
        destination: fields.destination ?? '',
        days: fields.days ?? 0,
        travelDate: fields.travelDate ?? '',
        ...(fields.budget_limit !== undefined
          ? { budget_limit: fields.budget_limit }
          : {}),
        ...(fields.user_preference
          ? { user_preference: fields.user_preference }
          : {}),
        ...(fields.travel_style
          ? { travel_style: fields.travel_style }
          : {}),
        ...(fields.destinations
          ? { destinations: fields.destinations }
          : {}),
        naturalLanguage: text,
        clarificationHistory:
          clarificationHistory.length > 0 ? clarificationHistory : undefined,
        conversationId: activeConversationId ?? undefined,
      };

      const streamResult = await generatePlanStream(request, mode, {
        onNodeComplete: (node, toolCalls) => {
          // 忽略 intent_agent 节点，不显示在执行进度中
          if (node === 'intent_agent' || node.endsWith(':intent_agent')) {
            return;
          }
          setPlanningStarted(true);
          setCompletedNodes((prev) => [...prev, node]);
          if (toolCalls && toolCalls.length > 0) {
            setStreamToolCalls((prev) => [...prev, ...toolCalls]);
          }
        },
        // Phase18：收到会话 ID 时更新当前会话并刷新列表
        onConversationId: (cid) => {
          if (cid && cid !== activeConversationId) {
            setActiveConversationId(cid);
          }
        },
      }, controller.signal);

      // 判断是追问还是规划结果
      if ((streamResult as ClarificationResult).needClarification === true) {
        const clarification = streamResult as ClarificationResult;
        // 添加助手追问消息
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: clarification.question },
        ]);
        // 保存已抽取字段和对话历史
        setPendingFields(clarification.extractedFields ?? {});
        setClarificationHistory((prev) => [
          ...prev,
          { role: 'user', content: text },
          { role: 'assistant', content: clarification.question },
        ]);
        // 刷新会话列表（新会话已创建）
        loadConversations();
      } else {
        // 规划完成
        const planResult = streamResult as JsonPlanResponse;
        setResult(planResult);
        setOriginalResult(planResult);
        // 重置追问状态
        setPendingFields({});
        setClarificationHistory([]);
        // 添加助手消息（规划结果通过 PlanResult 组件展示）
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: '已为您生成旅行规划方案：',
            planId: planResult.id,
          },
        ]);
        // 刷新会话列表（更新 planId 与时间）
        loadConversations();
      }
    } catch (err) {
      // 用户主动取消（中途改计划）不显示错误
      if ((err as Error).name === 'AbortError') {
        return;
      }
      setError(err instanceof Error ? err.message : '规划生成失败');
    } finally {
      // 仅当仍是当前请求时才重置状态
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
        setLoading(false);
      }
    }
  };

  /** Phase14：提交反馈修订 */
  const handleRevise = async (feedback: string) => {
    if (!result) return;
    setRevising(true);
    setError('');
    setReviseNodes([]);
    setReviseToolCalls([]);

    try {
      const revised = await revisePlanStream(
        result.id,
        { feedback, mode: 'mock' },
        {
          onNodeComplete: (node, toolCalls) => {
            setReviseNodes((prev) => [...prev, node]);
            if (toolCalls && toolCalls.length > 0) {
              setReviseToolCalls((prev) => [...prev, ...toolCalls]);
            }
          },
        },
      );
      setResult(revised);
      setIsRevised(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '修订规划失败');
    } finally {
      setRevising(false);
    }
  };

  /** Phase14：返回原规划 */
  const handleBackToOriginal = () => {
    if (originalResult) {
      setResult(originalResult);
      setIsRevised(false);
    }
  };

  return (
    <div className="animate-fade-in-up">
      <div className="mb-4">
        <h1 className="font-serif text-2xl font-semibold tracking-tight text-foreground">
          旅行规划助手
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          用自然语言描述你的旅行需求，AI 将为你生成完整方案
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive animate-fade-in">
          {error}
        </div>
      )}

      {/* Phase18：三栏布局 —— 左会话列表、中聊天框、右执行输出 */}
      <div className="grid h-[calc(100vh-200px)] min-h-0 grid-rows-1 gap-4 xl:grid-cols-[240px_1.5fr_1fr] lg:grid-cols-[220px_1fr]">
        {/* 左栏：会话列表 */}
        <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/80 p-4 shadow-sm backdrop-blur-sm">
          <SessionList
            conversations={conversations}
            activeId={activeConversationId}
            onSelect={handleSelectSession}
            onNew={handleNewSession}
            onDelete={handleDeleteSession}
          />
        </aside>

        {/* 中栏：对话面板 */}
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur-sm">
          <ChatPanel
            messages={messages}
            mode={mode}
            loading={loading}
            onModeChange={setMode}
            onSend={handleSend}
            onCancel={handleCancel}
          />
        </div>

        {/* 右栏：执行进度 + 规划结果 */}
        <div className="flex h-full min-h-0 flex-col overflow-y-auto xl:col-span-1">
          {/* 意图/追问阶段：仅显示提示，不显示执行进度 */}
          {loading && !planningStarted && !error && (
            <div className="flex flex-1 min-h-0 flex-col items-center justify-center rounded-2xl border border-border/60 bg-card/60 text-muted-foreground">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <span className="flex gap-1">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-primary/70 [animation-delay:0ms]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-primary/70 [animation-delay:150ms]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-primary/70 [animation-delay:300ms]" />
                </span>
              </div>
              <p className="text-sm">正在分析你的需求...</p>
            </div>
          )}

          {/* 实际规划进行中：显示执行进度 */}
          {loading && planningStarted && !error && (
            <ExecutionProgress
              completedNodes={completedNodes}
              running={loading}
              toolCalls={streamToolCalls}
            />
          )}

          {/* 修订进行中 */}
          {revising && !error && (
            <ExecutionProgress
              completedNodes={reviseNodes}
              running={revising}
              toolCalls={reviseToolCalls}
            />
          )}

          {/* 结果展示 */}
          {!loading && !revising && !error && result && (
            <PlanResult
              result={result}
              onRevise={handleRevise}
              revising={revising}
              isRevised={isRevised}
              onBackToOriginal={handleBackToOriginal}
            />
          )}

          {!loading && !revising && !error && !result && (
            <div className="flex flex-1 min-h-0 flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 bg-card/30 text-center">
              <div className="mb-3 text-3xl">🗺️</div>
              <p className="text-sm text-muted-foreground">
                在中间输入旅行需求以开始规划
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
