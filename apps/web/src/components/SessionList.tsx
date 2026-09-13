/**
 * 会话列表组件（Phase18 新增）
 * 左侧栏：新建会话按钮 + 历史会话列表
 */
import { Plus, MessageSquare, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ConversationItem } from '@/api/client';

interface SessionListProps {
  conversations: ConversationItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

/** 格式化时间为相对/简短显示 */
function formatTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin}分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}小时前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}天前`;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function SessionList({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
}: SessionListProps) {
  return (
    <div className="flex flex-1 min-h-0 flex-col">
      {/* 新建会话按钮 */}
      <Button
        onClick={onNew}
        className="mb-3 w-full justify-start gap-2"
        variant="outline"
      >
        <Plus className="h-4 w-4" />
        新建会话
      </Button>

      {/* 会话列表 */}
      <div className="flex-1 space-y-1.5 overflow-y-auto pr-1">
        {conversations.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-secondary">
              <MessageSquare className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground">还没有会话</p>
            <p className="mt-0.5 text-xs text-muted-foreground/70">
              开始一段新的旅行规划吧
            </p>
          </div>
        )}

        {conversations.map((conv) => (
          <div
            key={conv.id}
            onClick={() => onSelect(conv.id)}
            className={`group relative cursor-pointer rounded-xl border px-3 py-2.5 transition-all ${
              activeId === conv.id
                ? 'border-primary/40 bg-primary/5'
                : 'border-transparent hover:border-border/60 hover:bg-secondary/50'
            }`}
          >
            <div className="flex items-start gap-2">
              <MessageSquare
                className={`mt-0.5 h-4 w-4 shrink-0 ${
                  activeId === conv.id ? 'text-primary' : 'text-muted-foreground'
                }`}
              />
              <div className="min-w-0 flex-1">
                <p
                  className={`truncate text-sm font-medium ${
                    activeId === conv.id ? 'text-foreground' : 'text-foreground/90'
                  }`}
                >
                  {conv.title}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatTime(conv.updatedAt)}
                  {conv.planId && (
                    <span className="ml-1.5 text-primary/70">· 已生成方案</span>
                  )}
                </p>
              </div>
            </div>

            {/* 删除按钮（hover 显示） */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(conv.id);
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
              title="删除会话"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
