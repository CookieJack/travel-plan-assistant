import { z } from 'zod';

/**
 * TravelRequest 入参校验 schema
 * 与 packages/shared/src/travel.ts 中的 TravelRequest 接口保持一致
 */
export const travelRequestSchema = z.object({
  destination: z
    .string({ message: 'destination 为必填项' })
    .trim()
    .min(1, 'destination 不能为空'),
  days: z
    .number({ message: 'days 为必填项' })
    .int('days 必须为整数')
    .positive('days 必须为正整数'),
  travelDate: z
    .string({ message: 'travelDate 为必填项' })
    .trim()
    .min(1, 'travelDate 不能为空'),
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
});

export type TravelRequestInput = z.infer<typeof travelRequestSchema>;
