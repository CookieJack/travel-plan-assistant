import { ZodError, type ZodSchema } from 'zod';

/** 校验失败时的结构化错误 */
export interface ValidationError {
  code: 'VALIDATION_ERROR';
  message: string;
  /** 字段级错误详情 */
  details: Array<{ field: string; message: string }>;
}

/**
 * 统一校验函数
 * @param schema zod schema
 * @param data 待校验数据
 * @returns 校验通过返回解析后的数据；失败抛出 ValidationError
 */
export function validate<T>(schema: ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw formatZodError(result.error);
  }
  return result.data;
}

/**
 * 安全校验（不抛异常，返回结果对象）
 * 适用于需要分支处理的场景（如 LLM 输出校验失败时回退 mock）
 */
export function safeValidate<T>(
  schema: ZodSchema<T>,
  data: unknown,
): { success: true; data: T } | { success: false; error: ValidationError } {
  const result = schema.safeParse(data);
  if (!result.success) {
    return { success: false, error: formatZodError(result.error) };
  }
  return { success: true, data: result.data };
}

/** 将 ZodError 格式化为统一的 ValidationError */
function formatZodError(error: ZodError): ValidationError {
  const details = error.issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
  }));
  return {
    code: 'VALIDATION_ERROR',
    message: details.length > 0 ? details[0].message : '参数校验失败',
    details,
  };
}

/** 判断是否为校验错误 */
export function isValidationError(err: unknown): err is ValidationError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === 'VALIDATION_ERROR'
  );
}
