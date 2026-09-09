import { useState } from 'react';
import type { TravelRequest, ToolCallRecord } from '@travel/shared';
import { PlanForm } from '@/components/PlanForm';
import { PlanResult } from '@/components/PlanResult';
import { ExecutionProgress } from '@/components/ExecutionProgress';
import { generatePlanStream, type JsonPlanResponse, type RunMode } from '@/api/client';

/**
 * 规划页：左侧表单 + 右侧结果展示
 */
export function PlanPage() {
  const [result, setResult] = useState<JsonPlanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  // Phase11 新增：流式执行状态
  const [completedNodes, setCompletedNodes] = useState<string[]>([]);
  const [streamToolCalls, setStreamToolCalls] = useState<ToolCallRecord[]>([]);

  const handleSubmit = async (request: TravelRequest, mode: RunMode) => {
    setLoading(true);
    setError('');
    setResult(null);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : '规划生成失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[400px_1fr]">
      {/* 左侧表单 */}
      <div>
        <h1 className="text-2xl font-bold mb-4">新建旅行规划</h1>
        <PlanForm onSubmit={handleSubmit} loading={loading} />
      </div>

      {/* 右侧结果 */}
      <div>
        {error && (
          <div className="rounded-md bg-destructive/10 p-4 text-destructive mb-4">
            {error}
          </div>
        )}
        {loading && !error && (
          <ExecutionProgress
            completedNodes={completedNodes}
            running={loading}
            toolCalls={streamToolCalls}
          />
        )}
        {!loading && !error && result && <PlanResult result={result} />}
        {!loading && !error && !result && (
          <div className="flex items-center justify-center h-64 text-muted-foreground">
            请填写左侧表单并提交以生成规划方案
          </div>
        )}
      </div>
    </div>
  );
}
