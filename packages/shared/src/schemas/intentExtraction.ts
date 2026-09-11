import { z } from 'zod';

/**
 * intent_agent 抽取结果 schema（Phase17 新增）
 * 用于校验 LLM 从自然语言中抽取的结构化字段
 */

/** 可空数字字段的预处理：null/空字符串 → null，否则转数字 */
const nullableNumber = z.preprocess(
  (val) =>
    val === null || val === undefined || val === ''
      ? null
      : Number(val),
  z.number().positive().nullable().optional(),
);

export const intentExtractionSchema = z.object({
  destination: z.string().trim().default(''),
  days: z.coerce.number().int().positive().default(0),
  travelDate: z.string().trim().default(''),
  budget_limit: nullableNumber,
  user_preference: z.string().trim().nullable().optional(),
  travel_style: z.string().trim().nullable().optional(),
  destinations: z
    .array(
      z.object({
        city: z.string().trim().min(1),
        days: z.coerce.number().int().positive(),
      }),
    )
    .nullable()
    .optional(),
  /** LLM 生成的自然追问话术（仅当必填字段缺失时填写） */
  clarificationQuestion: z.string().trim().optional(),
});

export type IntentExtractionResult = z.infer<typeof intentExtractionSchema>;
