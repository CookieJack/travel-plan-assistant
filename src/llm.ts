/**
 * 豆包（字节方舟）LLM 统一封装
 * Phase2 新增：通过 @langchain/openai 指向豆包方舟 OpenAI 兼容接口
 *
 * 职责：
 * 1. 从 .env 读取密钥，全局复用单个 ChatOpenAI 实例
 * 2. 提供运行模式开关（mock / llm），不污染 state
 * 3. 提供 JSON 模式调用能力，供各 Agent 解析结构化输出
 *
 * 密钥禁止硬编码，全部来自环境变量
 */
import 'dotenv/config';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

/** 运行模式 */
export type RunMode = 'mock' | 'llm';

/** 当前运行模式，默认 mock（兼容 phase1 调试） */
let currentMode: RunMode = 'mock';

/** 设置运行模式（由 CLI 入口在启动时调用） */
export function setMode(mode: RunMode): void {
  currentMode = mode;
}

/** 获取当前运行模式 */
export function getMode(): RunMode {
  return currentMode;
}

/** 是否为真实 LLM 模式 */
export function isLLMMode(): boolean {
  return currentMode === 'llm';
}

/** 单例 LLM 实例（文本模式，供 Supervisor 生成自然语言方案） */
let llmInstance: ChatOpenAI | null = null;

/** 单例 LLM 实例（JSON 模式，供各子 Agent 输出结构化 JSON） */
let jsonLLMInstance: ChatOpenAI | null = null;

/**
 * 获取豆包 LLM 实例（单例，文本模式）
 * 密钥/模型缺失时返回 null，调用方应兜底到 mock
 */
export function getLLM(): ChatOpenAI | null {
  if (llmInstance) return llmInstance;

  const apiKey = process.env.DOUBAO_API_KEY;
  const model = process.env.DOUBAO_MODEL;
  const baseURL =
    process.env.DOUBAO_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3';

  if (!apiKey || !model) {
    return null;
  }

  llmInstance = new ChatOpenAI({
    model,
    apiKey,
    configuration: { baseURL },
    temperature: 0.7,
  });

  return llmInstance;
}

/**
 * 获取 JSON 模式的豆包 LLM 实例（单例）
 *
 * 注意：当前 @langchain/openai 版本的 ChatOpenAI 不提供 .bind() 方法，
 * 因此无法通过 llm.bind({ response_format }) 动态切换输出格式。
 * 此处通过构造函数 responseFormat 选项固定为 json_object，
 * 专用于需要结构化 JSON 输出的子 Agent。
 */
export function getJSONLLM(): ChatOpenAI | null {
  if (jsonLLMInstance) return jsonLLMInstance;

  const apiKey = process.env.DOUBAO_API_KEY;
  const model = process.env.DOUBAO_MODEL;
  const baseURL =
    process.env.DOUBAO_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3';

  if (!apiKey || !model) {
    return null;
  }

  jsonLLMInstance = new ChatOpenAI({
    model,
    apiKey,
    configuration: { baseURL },
    temperature: 0.7,
    responseFormat: { type: 'json_object' },
  });

  return jsonLLMInstance;
}

/** 类型守卫签名 */
export type Validator<T> = (data: unknown) => data is T;

/**
 * 以 JSON 模式调用豆包 LLM，返回解析后的对象
 *
 * Phase3 增强：
 * - 支持传入 `validate` 类型守卫对解析结果做结构化校验
 * - 解析失败或校验失败时自动重试（最多 maxRetries 次）
 * - 重试全部耗尽后抛出错误，由调用方决定是否回退 mock
 * - 控制台打印每个 Agent 实际使用的生成模式，便于调试感知
 *
 * @param systemPrompt Agent 专属系统提示词
 * @param userContent  携带 state 上下文的用户输入
 * @param validate     可选类型守卫，用于校验解析结果结构
 * @param maxRetries   解析/校验失败后的最大重试次数，默认 2
 * @param agentName    可选 Agent 名称，用于日志标注
 * @returns 解析并（可选）校验通过的 JSON 对象
 * @throws 当 LLM 未配置，或重试耗尽后仍解析/校验失败时抛出
 */
export async function callLLMJson<T = unknown>(
  systemPrompt: string,
  userContent: string,
  validate?: Validator<T>,
  maxRetries = 2,
  agentName = 'LLM',
): Promise<T> {
  const llm = getJSONLLM();
  if (!llm) {
    throw new Error(
      'LLM 未配置：请在 .env 中设置 DOUBAO_API_KEY 与 DOUBAO_MODEL',
    );
  }

  // 总尝试次数 = 1 次首次 + maxRetries 次重试
  const totalAttempts = maxRetries + 1;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    try {
      const response = await llm.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(userContent),
      ]);

      const content =
        typeof response.content === 'string' ? response.content : '';

      if (!content) {
        throw new Error('LLM 返回内容为空');
      }

      const parsed = JSON.parse(content) as unknown;

      // 若提供了校验函数，则执行结构化校验
      if (validate && !validate(parsed)) {
        throw new Error('LLM 输出未通过结构校验');
      }

      // 成功：打印实际模式
      if (attempt === 1) {
        console.log(`[${agentName}] 使用模式：llm(校验通过)`);
      } else {
        console.log(
          `[${agentName}] 使用模式：llm(重试${attempt - 1}次后通过)`,
        );
      }

      return parsed as T;
    } catch (err) {
      lastError = err as Error;
      // 非最后一次尝试：继续重试
      if (attempt < totalAttempts) {
        console.warn(
          `[${agentName}] LLM 输出异常（第 ${attempt}/${totalAttempts} 次）：${lastError.message}，准备重试...`,
        );
      }
    }
  }

  // 重试全部耗尽：抛出最终错误，由调用方回退 mock
  throw new Error(
    `[${agentName}] LLM 调用重试 ${maxRetries} 次后仍失败：${lastError?.message ?? '未知错误'}`,
  );
}
