import { Link } from 'react-router-dom';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MapPin, Calendar, Wallet } from 'lucide-react';
import type { PlanListItem } from '@/api/client';

interface PlanCardProps {
  plan: PlanListItem;
}

/**
 * 历史规划卡片
 * 设计改造：Wanderlust Editorial 风格
 */
export function PlanCard({ plan }: PlanCardProps) {
  const isMock = plan.mode === 'mock';
  const summaryText = plan.summary?.slice(0, 100) || '无摘要';

  return (
    <Card className="flex flex-col overflow-hidden transition-all duration-300 hover:-translate-y-1">
      {/* 顶部渐变条 */}
      <div className="h-1.5 w-full bg-gradient-to-r from-primary via-primary/60 to-accent" />
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-1.5 font-serif text-xl">
              <MapPin className="h-4 w-4 text-primary" />
              {plan.destination}
              <span className="text-muted-foreground">·</span>
              <span className="text-lg">{plan.days}天</span>
            </CardTitle>
            <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
              <Calendar className="h-3.5 w-3.5" />
              {plan.travelDate}
            </p>
          </div>
          <span
            className={
              'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ' +
              (isMock
                ? 'bg-accent/10 text-accent'
                : 'bg-primary/10 text-primary')
            }
          >
            {isMock ? 'Mock' : 'LLM'}
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex-1 pb-3">
        {plan.budgetLimit !== null && (
          <p className="mb-2 flex items-center gap-1.5 text-sm text-muted-foreground">
            <Wallet className="h-3.5 w-3.5" />
            预算上限：¥{plan.budgetLimit}
          </p>
        )}
        <p className="line-clamp-2 text-sm leading-relaxed text-foreground/70">
          {summaryText}
          {plan.summary && plan.summary.length > 100 ? '...' : ''}
        </p>
      </CardContent>
      <CardFooter className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {new Date(plan.createdAt).toLocaleString('zh-CN')}
        </span>
        <Button variant="outline" size="sm" asChild>
          <Link to={`/plans/${plan.id}`}>查看详情</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
