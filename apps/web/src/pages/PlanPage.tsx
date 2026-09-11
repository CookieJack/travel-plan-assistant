import { useState } from 'react';
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

  // Phase14 修订状态
  const [originalResult, setOriginalResult] = useState<JsonPlanResponse | null>(null);
  const [isRevised, setIsRevised] = useState(false);
  const [revising, setRevising] = useState(false);
  const [reviseNodes, setReviseNodes] = useState<string[]>([]);
  const [reviseToolCalls, setReviseToolCalls] = useState<ToolCallRecord[]>([]);

  /** 发送用户消息 */
  const handleSend = async (text: string) => {
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
      });

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
      setError(err instanceof Error ? err.message : '规划生成失败');
    } finally {
      setLoading(false);
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-2">旅行规划助手</h1>
        <p className="text-muted-foreground text-sm">
          用自然语言描述您的旅行需求，我会为您生成完整的规划方案
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 p-4 text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 左侧：对话面板 */}
        <div className="border rounded-lg p-4">
          <ChatPanel
            messages={messages}
            mode={mode}
            loading={loading}
            onModeChange={setMode}
            onSend={handleSend}
          />
        </div>

        {/* 右侧：执行进度 + 规划结果 */}
        <div>
          {/* 意图/追问阶段：仅显示提示，不显示执行进度 */}
          {loading && !planningStarted && !error && (
            <div className="flex items-center justify-center h-64 text-muted-foreground">
              正在分析您的需求...
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
            <div className="flex items-center justify-center h-64 text-muted-foreground">
              在左侧输入旅行需求以开始规划
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
