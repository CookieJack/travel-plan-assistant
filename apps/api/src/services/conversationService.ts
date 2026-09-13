/**
 * 会话服务（Phase18 新增）
 * 封装 Conversation / ConversationMessage 的数据库操作
 */
import { prisma } from '../lib/prisma.js';

/** 会话标题最大长度 */
const TITLE_MAX_LENGTH = 20;

/** 截断用户消息生成会话标题 */
function makeTitle(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length > TITLE_MAX_LENGTH
    ? trimmed.slice(0, TITLE_MAX_LENGTH) + '…'
    : trimmed;
}

/** 创建会话（第一条用户消息时调用） */
export async function createConversation(
  userId: string | undefined,
  firstUserMessage: string,
): Promise<{ id: string; title: string }> {
  const conv = await prisma.conversation.create({
    data: {
      userId: userId ?? null,
      title: makeTitle(firstUserMessage),
    },
    select: { id: true, title: true },
  });
  return conv;
}

/** 追加消息到会话 */
export async function addMessage(params: {
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  type: 'text' | 'clarification' | 'plan_result';
  planId?: string;
  data?: unknown;
}): Promise<void> {
  await prisma.conversationMessage.create({
    data: {
      conversationId: params.conversationId,
      role: params.role,
      content: params.content,
      type: params.type,
      planId: params.planId ?? null,
      data: params.data ? (params.data as object) : null,
    },
  });
}

/** 更新会话关联的规划 ID */
export async function attachPlanToConversation(
  conversationId: string,
  planId: string,
): Promise<void> {
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { planId },
  });
}

/** 会话列表项 */
export interface ConversationListItem {
  id: string;
  title: string;
  planId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 查询会话列表（按用户过滤，未登录返回匿名会话） */
export async function listConversations(
  userId: string | undefined,
): Promise<ConversationListItem[]> {
  return prisma.conversation.findMany({
    where: { userId: userId ?? null },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      title: true,
      planId: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

/** 会话详情（含消息） */
export interface ConversationDetail {
  id: string;
  title: string;
  planId: string | null;
  createdAt: Date;
  updatedAt: Date;
  messages: Array<{
    id: string;
    role: string;
    content: string;
    type: string;
    planId: string | null;
    data: unknown;
    createdAt: Date;
  }>;
}

/** 查询会话详情 */
export async function getConversation(
  id: string,
  userId: string | undefined,
): Promise<ConversationDetail | null> {
  const conv = await prisma.conversation.findFirst({
    where: { id, userId: userId ?? null },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          role: true,
          content: true,
          type: true,
          planId: true,
          data: true,
          createdAt: true,
        },
      },
    },
  });
  return conv;
}

/** 删除会话（级联删除消息） */
export async function deleteConversation(
  id: string,
  userId: string | undefined,
): Promise<boolean> {
  const result = await prisma.conversation.deleteMany({
    where: { id, userId: userId ?? null },
  });
  return result.count > 0;
}
