import { useState } from 'react';
import { ChevronDown, ChevronRight, Wrench } from 'lucide-react';
import type { ToolCallRecord } from '@travel/shared';
import { cn } from '@/lib/utils';

interface ToolCallListProps {
  toolCalls: ToolCallRecord[];
}

/**
 * 工具调用记录列表（Phase11 新增）
 * 展示 Agent 调用工具的过程：工具名、参数、结果摘要、模式、时间
 */
export function ToolCallList({ toolCalls }: ToolCallListProps) {
  if (toolCalls.length === 0) {
    return <p className="text-sm text-muted-foreground">暂无工具调用记录</p>;
  }

  return (
    <ul className="space-y-3">
      {toolCalls.map((tc, i) => (
        <ToolCallItem key={i} record={tc} index={i + 1} />
      ))}
    </ul>
  );
}

/** 单条工具调用记录 */
function ToolCallItem({ record, index }: { record: ToolCallRecord; index: number }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <li className="rounded-xl border border-border/60 bg-card p-3 transition-colors hover:border-primary/30">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Wrench className="h-4 w-4 shrink-0 text-primary" />
          <span className="shrink-0 text-xs text-muted-foreground">#{index}</span>
          <span className="truncate font-medium text-sm">{record.toolName}</span>
          <span className="shrink-0 text-xs text-muted-foreground">· {record.agent}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ModeBadge mode={record.mode} />
          <span className="text-xs text-muted-foreground">
            {new Date(record.timestamp).toLocaleTimeString('zh-CN')}
          </span>
        </div>
      </div>

      <div className="mt-2 line-clamp-2 text-xs text-muted-foreground">
        {record.resultSummary}
      </div>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-2 flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-primary"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        {expanded ? '收起参数' : '查看参数'}
      </button>

      {expanded && (
        <pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-3 text-xs">
          {JSON.stringify(record.args, null, 2)}
        </pre>
      )}
    </li>
  );
}

/** 调用模式徽标 */
function ModeBadge({ mode }: { mode: ToolCallRecord['mode'] }) {
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-[10px] font-medium',
        mode === 'llm'
          ? 'bg-primary/10 text-primary'
          : 'bg-muted text-muted-foreground',
      )}
    >
      {mode}
    </span>
  );
}
