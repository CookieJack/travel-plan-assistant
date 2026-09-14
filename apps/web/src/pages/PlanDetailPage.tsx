import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PlanResult } from '@/components/PlanResult';
import { getPlanById, type PlanDetail } from '@/api/client';

/**
 * 规划详情页：展示单条历史规划的完整内容
 */
export function PlanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<PlanDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    getPlanById(id)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '查询失败');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        加载中...
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/plans">
            <ArrowLeft className="h-4 w-4 mr-1" />
            返回列表
          </Link>
        </Button>
        <div className="rounded-md bg-destructive/10 p-6 text-destructive text-center">
          {error}
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/plans">
            <ArrowLeft className="h-4 w-4 mr-1" />
            返回列表
          </Link>
        </Button>
        <div className="rounded-md bg-muted p-6 text-center text-muted-foreground">
          规划记录不存在
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/plans">
            <ArrowLeft className="h-4 w-4 mr-1" />
            返回列表
          </Link>
        </Button>
        <span className="text-sm text-muted-foreground">
          创建于 {new Date(detail.createdAt).toLocaleString('zh-CN')}
        </span>
      </div>
      <h1 className="font-serif text-2xl font-semibold tracking-tight">
        {detail.request.destination} · {detail.request.days}天规划详情
      </h1>
      <PlanResult result={detail} />
    </div>
  );
}
