import { z } from 'zod';

/** 规划修订请求校验 schema */
export const reviseRequestSchema = z.object({
  feedback: z
    .string({ message: 'feedback 为必填项' })
    .trim()
    .min(1, '反馈内容不能为空')
    .max(1000, '反馈内容不能超过 1000 字'),
  mode: z.enum(['mock', 'llm']).optional(),
});

export type ReviseRequestInput = z.infer<typeof reviseRequestSchema>;
