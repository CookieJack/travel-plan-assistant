/**
 * Phase16 新增：登录/注册页面
 * 设计改造：Wanderlust Editorial 风格
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Compass, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { login, register } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login(username, password);
      } else {
        await register(username, password);
      }
      navigate('/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="app-bg flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* 品牌标识 */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-lg">
            <Compass className="h-7 w-7" />
          </div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground">
            Wanderlust
          </h1>
          <p className="mt-2 flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            开启你的下一段旅程
          </p>
        </div>

        <div className="rounded-2xl border border-border/60 bg-card/90 p-8 shadow-xl backdrop-blur-sm">
          <h2 className="font-serif text-xl font-semibold text-foreground">
            {mode === 'login' ? '欢迎回来' : '创建账号'}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === 'login'
              ? '登录后可保存规划与个性化偏好'
              : '开启个性化旅行规划之旅'}
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                用户名
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                minLength={1}
                maxLength={50}
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground transition-colors placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
                placeholder="请输入用户名"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                密码
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                maxLength={100}
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground transition-colors placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
                placeholder="至少 6 位"
              />
            </div>

            {error && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-primary py-2.5 font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary/90 hover:shadow-md disabled:opacity-50"
            >
              {submitting ? '处理中...' : mode === 'login' ? '登录' : '注册'}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            {mode === 'login' ? (
              <>
                还没有账号？
                <button
                  onClick={() => setMode('register')}
                  className="ml-1 font-medium text-primary hover:underline"
                >
                  立即注册
                </button>
              </>
            ) : (
              <>
                已有账号？
                <button
                  onClick={() => setMode('login')}
                  className="ml-1 font-medium text-primary hover:underline"
                >
                  去登录
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
