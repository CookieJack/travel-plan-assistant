import { CheckCircle2, Loader2, Circle } from 'lucide-react';
import type { ToolCallRecord } from '@travel/shared';
import { cn } from '@/lib/utils';
import { ToolCallList } from './ToolCallList';

interface ExecutionProgressProps {
  /** 已完成的节点列表（按完成顺序） */
  completedNodes: string[];
  /** 当前是否正在执行 */
  running: boolean;
  /** 已收到的工具调用记录 */
  toolCalls: ToolCallRecord[];
}

/** LangGraph 节点定义与执行顺序 */
const NODE_GROUPS: { name: string; label: string }[][] = [
  [
    { name: 'flight_agent', label: '机票 Agent' },
    { name: 'hotel_agent', label: '酒店 Agent' },
    { name: 'activities_agent', label: '游玩活动 Agent' },
  ],
  [{ name: 'budgeting_agent', label: '预算 Agent' }],
  [{ name: 'supervisor_agent', label: '主控汇总' }],
];

type NodeStatus = 'pending' | 'running' | 'done';

/**
 * 计算每个节点的状态
 * - done: 已在 completedNodes 中
 * - running: 当前批次中未完成的节点（running=true 时）
 * - pending: 后续批次的节点
 */
function getNodeStatus(nodeName: string, completedNodes: string[], running: boolean): NodeStatus {
  if (completedNodes.includes(nodeName)) return 'done';

  // 找到该节点所在的批次索引
  const groupIdx = NODE_GROUPS.findIndex((group) =>
    group.some((n) => n.name === nodeName),
  );
  if (groupIdx === -1) return 'pending';

  // 检查之前的批次是否全部完成
  const prevGroupsAllDone = NODE_GROUPS.slice(0, groupIdx).every((group) =>
    group.every((n) => completedNodes.includes(n.name)),
  );

  if (prevGroupsAllDone && running) return 'running';
  return 'pending';
}

/**
 * 实时执行进度展示（Phase11 新增）
 * 展示 Agent 节点状态流转 + 工具调用实时流
 */
export function ExecutionProgress({
  completedNodes,
  running,
  toolCalls,
}: ExecutionProgressProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-3">执行进度</h2>
        <div className="space-y-4">
          {NODE_GROUPS.map((group, gi) => (
            <div key={gi}>
              <div className="flex flex-wrap gap-3">
                {group.map((node) => {
                  const status = getNodeStatus(node.name, completedNodes, running);
                  return (
                    <NodeItem key={node.name} label={node.label} status={status} />
                  );
                })}
              </div>
              {gi < NODE_GROUPS.length - 1 && (
                <div className="my-2 ml-4 h-4 w-px bg-border" />
              )}
            </div>
          ))}
        </div>
      </div>

      {toolCalls.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">工具调用</h2>
          <ToolCallList toolCalls={toolCalls} />
        </div>
      )}
    </div>
  );
}

/** 单个节点状态展示 */
function NodeItem({ label, status }: { label: string; status: NodeStatus }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors',
        status === 'done' && 'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950',
        status === 'running' && 'border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950',
        status === 'pending' && 'border-border bg-muted/30',
      )}
    >
      {status === 'done' && (
        <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
      )}
      {status === 'running' && (
        <Loader2 className="h-4 w-4 animate-spin text-blue-600 dark:text-blue-400" />
      )}
      {status === 'pending' && (
        <Circle className="h-4 w-4 text-muted-foreground" />
      )}
      <span
        className={cn(
          status === 'pending' && 'text-muted-foreground',
        )}
      >
        {label}
      </span>
    </div>
  );
}
