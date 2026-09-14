/**
 * 对话面板组件（Phase17 新增）
 * 以自然语言对话形式进行旅行规划
 * 设计改造：Wanderlust Editorial 风格气泡
 */
import { useState, useRef, useEffect } from 'react';
import { Send, Square, Sparkles, Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { RunMode } from '@/api/client';

/** 对话消息 */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** 助手消息携带的规划结果 ID（用于渲染 PlanResult） */
  planId?: string;
}

interface ChatPanelProps {
  messages: ChatMessage[];
  mode: RunMode;
  loading: boolean;
  onModeChange: (mode: RunMode) => void;
  onSend: (text: string) => void;
  /** 取消当前生成（中途改计划时调用） */
  onCancel?: () => void;
}

export function ChatPanel({
  messages,
  mode,
  loading,
  onModeChange,
  onSend,
  onCancel,
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages, loading]);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    onSend(text);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      {/* 消息列表 */}
      <div
        ref={scrollRef}
        className="flex-1 space-y-5 overflow-y-auto pr-2"
      >
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-accent/15">
              <Sparkles className="h-8 w-8 text-primary" />
            </div>
            <h3 className="font-serif text-xl font-semibold text-foreground">
              开启你的下一段旅程
            </h3>
            <p className="mt-2 max-w-xs text-sm text-muted-foreground">
              用自然语言描述你的旅行需求，我会为你量身定制完整规划
            </p>
            <div className="mt-5 space-y-2">
              {[
                '国庆去成都玩5天，预算8000，喜欢美食',
                '周末去杭州放松2天，想要小众景点',
                '西安玩3天再去成都玩2天，人文路线',
              ].map((tip) => (
                <button
                  key={tip}
                  onClick={() => setInput(tip)}
                  className="block w-full rounded-xl border border-border/70 bg-card/60 px-4 py-2.5 text-left text-sm text-muted-foreground transition-all hover:border-primary/40 hover:bg-secondary hover:text-foreground"
                >
                  "{tip}"
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} ${
              idx === messages.length - 1
                ? msg.role === 'user'
                  ? 'animate-slide-in-right'
                  : 'animate-slide-in-left'
                : ''
            }`}
          >
            {msg.role === 'assistant' && (
              <div className="mr-2.5 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent/70 text-accent-foreground">
                <Bot className="h-4 w-4" />
              </div>
            )}
            <div
              className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'rounded-br-sm bg-gradient-to-br from-primary to-primary/85 text-primary-foreground shadow-md'
                  : 'rounded-bl-sm border border-border/60 bg-card text-foreground shadow-sm'
              }`}
            >
              <p className="whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start animate-fade-in">
            <div className="mr-2.5 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent/70 text-accent-foreground">
              <Bot className="h-4 w-4" />
            </div>
            <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm border border-border/60 bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm">
              <span className="flex gap-1">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/60 [animation-delay:0ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/60 [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/60 [animation-delay:300ms]" />
              </span>
              <span>正在为你规划中，稍等一下～</span>
            </div>
          </div>
        )}
      </div>

      {/* 输入区域 */}
      <div className="mt-4 space-y-3 border-t border-border/60 pt-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">运行模式</span>
          <Select value={mode} onValueChange={(v) => onModeChange(v as RunMode)}>
            <SelectTrigger className="h-8 w-36 text-xs" disabled={loading}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mock">Mock · 模拟数据</SelectItem>
              <SelectItem value="llm">LLM · 真实大模型</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              loading ? '想调整计划？直接输入新需求即可' : '描述你的旅行需求...'
            }
            className="min-h-[60px] resize-none py-3"
            rows={2}
          />
          {loading ? (
            <Button
              onClick={() => onCancel?.()}
              variant="outline"
              className="h-[60px] shrink-0 px-4"
            >
              <Square className="h-4 w-4 fill-current" />
              取消
            </Button>
          ) : (
            <Button
              onClick={handleSend}
              disabled={!input.trim()}
              className="h-[60px] shrink-0 px-5"
            >
              <Send className="h-4 w-4" />
              发送
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
