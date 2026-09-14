import { z } from 'zod';

/** 列表查询分页参数 */
export const paginationSchema = z.object({
  page: z
    .string()
    .optional()
    .transform((v) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1) return 1;
      return n;
    }),
  pageSize: z
    .string()
    .optional()
    .transform((v) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1) return 10;
      return Math.min(n, 50);
    }),
  destination: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : undefined)),
});

export type PaginationInput = z.infer<typeof paginationSchema>;
