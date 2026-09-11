import { useState, useRef } from 'react';
import type { TravelRequest, ToolCallRecord } from '@travel/shared';
import { ChatPanel, type ChatMessage } from '@/components/ChatPanel';
import { PlanResult } from '@/components/PlanResult';
import { ExecutionProgress } from '@/components/ExecutionProgress';
import {
  generatePlanStream,
  revisePlanStream,
  type JsonPlanResponse,
  type RunMode,
  type ClarificationResult,
} from '@/api/client';

/**
 * 规划页：自然语言对话式旅行规划
 * Phase17 重构：移除结构化表单，改为对话输入
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
      // 构造请求：自然语言 + 对话历史 + 已抽取字段
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
    <div className="space-y-6 animate-fade-in-up">
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground">
          旅行规划助手
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          用自然语言描述你的旅行需求，AI 将为你生成完整的机票、酒店、行程与预算方案
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive animate-fade-in">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 左侧：对话面板 */}
        <div className="rounded-2xl border border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur-sm">
          <ChatPanel
            messages={messages}
            mode={mode}
            loading={loading}
            onModeChange={setMode}
            onSend={handleSend}
            onCancel={handleCancel}
          />
        </div>

        {/* 右侧：执行进度 + 规划结果 */}
        <div>
          {/* 意图/追问阶段：仅显示提示，不显示执行进度 */}
          {loading && !planningStarted && !error && (
            <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-border/60 bg-card/60 text-muted-foreground">
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
            <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 bg-card/30 text-center">
              <div className="mb-3 text-3xl">🗺️</div>
              <p className="text-sm text-muted-foreground">
                在左侧输入旅行需求以开始规划
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
