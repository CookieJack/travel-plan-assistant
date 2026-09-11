import { z } from 'zod';

/**
 * intent_agent 抽取结果 schema（Phase17 新增）
 * 用于校验 LLM 从自然语言中抽取的结构化字段
 */
export const intentExtractionSchema = z.object({
  destination: z.string().trim().default(''),
  days: z.number().int().positive().default(0),
  travelDate: z.string().trim().default(''),
  budget_limit: z.number().positive().nullable().optional(),
  user_preference: z.string().trim().nullable().optional(),
  travel_style: z.string().trim().nullable().optional(),
  destinations: z
    .array(
      z.object({
        city: z.string().trim().min(1),
        days: z.number().int().positive(),
      }),
    )
    .nullable()
    .optional(),
});

export type IntentExtractionResult = z.infer<typeof intentExtractionSchema>;
