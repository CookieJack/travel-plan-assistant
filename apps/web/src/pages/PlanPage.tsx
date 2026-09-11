import { useState } from 'react';
import type { TravelRequest, ToolCallRecord } from '@travel/shared';
import { PlanForm } from '@/components/PlanForm';
import { PlanResult } from '@/components/PlanResult';
import { ExecutionProgress } from '@/components/ExecutionProgress';
import {
  generatePlanStream,
  revisePlanStream,
  type JsonPlanResponse,
  type RunMode,
} from '@/api/client';

/**
 * 规划页：左侧表单 + 右侧结果展示
 * Phase14 新增：反馈修订流程
 */
export function PlanPage() {
  // 初始规划状态
  const [result, setResult] = useState<JsonPlanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [completedNodes, setCompletedNodes] = useState<string[]>([]);
  const [streamToolCalls, setStreamToolCalls] = useState<ToolCallRecord[]>([]);

  // Phase14 新增：修订状态
  const [originalResult, setOriginalResult] = useState<JsonPlanResponse | null>(null);
  const [isRevised, setIsRevised] = useState(false);
  const [revising, setRevising] = useState(false);
  const [reviseNodes, setReviseNodes] = useState<string[]>([]);
  const [reviseToolCalls, setReviseToolCalls] = useState<ToolCallRecord[]>([]);

  /** 提交初始规划 */
  const handleSubmit = async (request: TravelRequest, mode: RunMode) => {
    setLoading(true);
    setError('');
    setResult(null);
    setOriginalResult(null);
    setIsRevised(false);
    setCompletedNodes([]);
    setStreamToolCalls([]);

    try {
      const data = await generatePlanStream(request, mode, {
        onNodeComplete: (node, toolCalls) => {
          setCompletedNodes((prev) => [...prev, node]);
          if (toolCalls && toolCalls.length > 0) {
            setStreamToolCalls((prev) => [...prev, ...toolCalls]);
          }
        },
      });
      setResult(data);
      setOriginalResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '规划生成失败');
    } finally {
      setLoading(false);
    }
  };

  /** Phase14 新增：提交反馈修订 */
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

  /** Phase14 新增：返回原规划 */
  const handleBackToOriginal = () => {
    if (originalResult) {
      setResult(originalResult);
      setIsRevised(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[400px_1fr]">
      {/* 左侧表单 */}
      <div>
        <h1 className="text-2xl font-bold mb-4">新建旅行规划</h1>
        <PlanForm onSubmit={handleSubmit} loading={loading || revising} />
      </div>

      {/* 右侧结果 */}
      <div>
        {error && (
          <div className="rounded-md bg-destructive/10 p-4 text-destructive mb-4">
            {error}
          </div>
        )}

        {/* 初始规划进行中 */}
        {loading && !error && (
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
            请填写左侧表单并提交以生成规划方案
          </div>
        )}
      </div>
    </div>
  );
}
