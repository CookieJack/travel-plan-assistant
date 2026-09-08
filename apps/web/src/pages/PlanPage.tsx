import { useState } from 'react';
import type { TravelRequest } from '@travel/shared';
import { PlanForm } from '@/components/PlanForm';
import { PlanResult } from '@/components/PlanResult';
import { generatePlan, type JsonPlanResponse, type RunMode } from '@/api/client';

/**
 * 规划页：左侧表单 + 右侧结果展示
 */
export function PlanPage() {
  const [result, setResult] = useState<JsonPlanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  const handleSubmit = async (request: TravelRequest, mode: RunMode) => {
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const data = await generatePlan(request, mode);
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
        {loading && (
          <div className="flex items-center justify-center h-64 text-muted-foreground">
            正在生成规划方案，请稍候...
          </div>
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
