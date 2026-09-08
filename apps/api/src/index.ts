/**
 * Hono 应用入口
 * 创建 app、注册路由、启动 HTTP 服务
 */
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';

// 显式加载项目根目录的 .env（API 从 apps/api 启动，cwd 不是根目录）
// 必须在动态导入路由之前执行，确保 DATABASE_URL 等环境变量在 Prisma 客户端创建前就绪
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '../../../.env') });

// 动态导入路由（确保环境变量已加载）
const { health } = await import('./routes/health.js');
const { plan } = await import('./routes/plan.js');
const { plans } = await import('./routes/plans.js');

// 创建 Hono 应用
const app = new Hono();

// CORS 中间件：允许前端跨域调用
app.use(
  '/api/*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
  }),
);

// 注册路由
app.route('/api/health', health);
app.route('/api/plan', plan);
app.route('/api/plans', plans);

// 全局错误处理
app.onError((err, c) => {
  console.error('[App] 未处理异常：', err);
  return c.json(
    { error: `服务器内部错误：${err.message}`, code: 'INTERNAL_ERROR' },
    500,
  );
});

// 404 处理
app.notFound((c) => {
  return c.json({ error: `路由不存在：${c.req.method} ${c.req.path}`, code: 'VALIDATION_ERROR' }, 404);
});

// 启动服务
const port = Number(process.env.PORT) || 3000;

console.log(`🚀 旅行规划 API 服务启动中...`);
console.log(`   模式：${process.env.NODE_ENV || 'development'}`);
console.log(`   端口：${port}`);

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`✅ 服务已启动：http://localhost:${info.port}`);
    console.log(`   健康检查：http://localhost:${info.port}/api/health`);
    console.log(`   规划接口：POST http://localhost:${info.port}/api/plan`);
  },
);
