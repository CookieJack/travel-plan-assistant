/**
 * 对话面板组件（Phase17 新增）
 * 以自然语言对话形式进行旅行规划
 */
import { useState, useRef, useEffect } from 'react';
import type { TravelRequest, ClarificationMessage } from '@travel/shared';
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
}

export function ChatPanel({
  messages,
  mode,
  loading,
  onModeChange,
  onSend,
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
    if (!text || loading) return;
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
    <div className="flex flex-col h-[calc(100vh-200px)]">
      {/* 消息列表 */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2"
      >
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-muted-foreground text-center">
            <div>
              <p className="text-lg font-medium mb-2">旅行规划助手</p>
              <p className="text-sm">用自然语言描述你的旅行需求，例如：</p>
              <p className="text-sm mt-1 text-muted-foreground">
                "我想国庆去成都玩5天，预算8000，喜欢美食"
              </p>
            </div>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-3 ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground'
              }`}
            >
              <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-lg px-4 py-3 text-sm text-muted-foreground">
              正在分析您的需求...
            </div>
          </div>
        )}
      </div>

      {/* 输入区域 */}
      <div className="border-t pt-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">运行模式：</span>
          <Select value={mode} onValueChange={(v) => onModeChange(v as RunMode)}>
            <SelectTrigger className="w-40" disabled={loading}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mock">Mock（模拟数据）</SelectItem>
              <SelectItem value="llm">LLM（真实大模型）</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="描述你的旅行需求..."
            disabled={loading}
            className="min-h-[60px] resize-none"
          />
          <Button onClick={handleSend} disabled={loading || !input.trim()} className="self-end">
            发送
          </Button>
        </div>
      </div>
    </div>
  );
}
