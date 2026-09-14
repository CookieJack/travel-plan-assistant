/**
 * 会话路由（Phase18 新增）
 * GET    /api/conversations          会话列表
 * GET    /api/conversations/:id      会话详情（含消息）
 * DELETE /api/conversations/:id      删除会话
 */
import { Hono } from 'hono';
import { optionalAuth } from '../middleware/auth.js';
import {
  listConversations,
  getConversation,
  deleteConversation,
} from '../services/conversationService.js';

const conversations = new Hono();

// GET /api/conversations
conversations.get('/', optionalAuth, async (c) => {
  const userId = c.get('userId');
  try {
    const items = await listConversations(userId);
    return c.json({ items });
  } catch (err) {
    console.error('[ConversationsRoute] 查询会话列表失败：', (err as Error).message);
    return c.json(
      { error: '查询会话列表失败', code: 'INTERNAL_ERROR' },
      500,
    );
  }
});

// GET /api/conversations/:id
conversations.get('/:id', optionalAuth, async (c) => {
  const id = c.req.param('id');
  const userId = c.get('userId');
  try {
    const conv = await getConversation(id, userId);
    if (!conv) {
      return c.json({ error: '会话不存在', code: 'NOT_FOUND' }, 404);
    }
    return c.json(conv);
  } catch (err) {
    console.error('[ConversationsRoute] 查询会话详情失败：', (err as Error).message);
    return c.json(
      { error: '查询会话详情失败', code: 'INTERNAL_ERROR' },
      500,
    );
  }
});

// DELETE /api/conversations/:id
conversations.delete('/:id', optionalAuth, async (c) => {
  const id = c.req.param('id');
  const userId = c.get('userId');
  try {
    const deleted = await deleteConversation(id, userId);
    if (!deleted) {
      return c.json({ error: '会话不存在', code: 'NOT_FOUND' }, 404);
    }
    return c.json({ success: true });
  } catch (err) {
    console.error('[ConversationsRoute] 删除会话失败：', (err as Error).message);
    return c.json(
      { error: '删除会话失败', code: 'INTERNAL_ERROR' },
      500,
    );
  }
});

export { conversations };
