import { Link } from 'react-router-dom';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { PlanListItem } from '@/api/client';

interface PlanCardProps {
  plan: PlanListItem;
}

/**
 * 历史规划卡片
 */
export function PlanCard({ plan }: PlanCardProps) {
  const isMock = plan.mode === 'mock';
  const summaryText = plan.summary?.slice(0, 100) || '无摘要';

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-xl">
              {plan.destination} · {plan.days}天
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              出行日期：{plan.travelDate}
            </p>
          </div>
          <span
            className={
              'px-2 py-1 rounded text-xs font-medium ' +
              (isMock
                ? 'bg-blue-100 text-blue-700'
                : 'bg-purple-100 text-purple-700')
            }
          >
            {isMock ? 'Mock' : 'LLM'}
          </span>
        </div>
      </CardHeader>
      <CardContent className="pb-3">
        {plan.budgetLimit !== null && (
          <p className="text-sm text-muted-foreground">
            预算上限：¥{plan.budgetLimit}
          </p>
        )}
        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
          {summaryText}
          {plan.summary && plan.summary.length > 100 ? '...' : ''}
        </p>
      </CardContent>
      <CardFooter className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          创建于 {new Date(plan.createdAt).toLocaleString('zh-CN')}
        </span>
        <Button variant="outline" size="sm" asChild>
          <Link to={`/plans/${plan.id}`}>查看详情</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
