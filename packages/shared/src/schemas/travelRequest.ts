import { z } from 'zod';

/**
 * TravelRequest 入参校验 schema
 * 与 packages/shared/src/travel.ts 中的 TravelRequest 接口保持一致
 *
 * Phase17 调整：
 * - destination/days/travelDate 改为可选（自然语言模式下由 intent_agent 抽取）
 * - 新增 naturalLanguage 和 clarificationHistory 字段
 */
export const travelRequestSchema = z.object({
  destination: z
    .string()
    .trim()
    .optional()
    .default(''),
  days: z
    .number()
    .int('days 必须为整数')
    .min(0, 'days 不能为负数')
    .optional()
    .default(0),
  travelDate: z
    .string()
    .trim()
    .optional()
    .default(''),
  user_preference: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v === null ? undefined : v)),
  budget_limit: z
    .number()
    .positive('budget_limit 必须为正数')
    .optional()
    .nullable()
    .transform((v) => (v === null ? undefined : v)),
  travel_style: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v === null ? undefined : v)),
  // Phase15 新增：多城市目的地列表
  destinations: z
    .array(
      z.object({
        city: z.string({ message: '城市名为必填项' }).trim().min(1, '城市名不能为空'),
        days: z
          .number({ message: '每城天数为必填项' })
          .int('每城天数必须为整数')
          .positive('每城天数必须为正整数'),
      }),
    )
    .min(2, '多城市至少需要 2 个城市')
    .optional(),
  // Phase17 新增：自然语言输入与对话历史
  naturalLanguage: z.string().trim().optional(),
  clarificationHistory: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1, '消息内容不能为空'),
      }),
    )
    .optional(),
  // Phase18 新增：关联的会话 ID
  conversationId: z.string().trim().optional(),
});

export type TravelRequestInput = z.infer<typeof travelRequestSchema>;
