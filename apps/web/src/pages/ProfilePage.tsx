/**
 * Phase16 新增：个人设置页面
 * 修改用户默认出行风格、预算上限、偏好
 * 设计改造：Wanderlust Editorial 风格
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getPreferences, updatePreferences, type UserPreferences } from '../api/client';

const STYLE_OPTIONS = ['穷游', '舒适', '轻奢'];

export default function ProfilePage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [prefs, setPrefs] = useState<UserPreferences>({
    defaultStyle: null,
    defaultBudget: null,
    defaultPreference: null,
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  // 未登录跳转登录
  useEffect(() => {
    if (!loading && !user) {
      navigate('/login');
    }
  }, [user, loading, navigate]);

  // 加载现有偏好
  useEffect(() => {
    if (!user) return;
    getPreferences()
      .then((p) => setPrefs(p))
      .catch(() => {});
  }, [user]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setMsg('');
    setSaving(true);
    try {
      const updated = await updatePreferences(prefs);
      setPrefs(updated);
      setMsg('保存成功');
    } catch (error) {
      setErr((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        加载中...
      </div>
    );
  }

  const inputClass =
    'flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground transition-colors placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1';

  return (
    <div className="mx-auto max-w-2xl animate-fade-in-up">
      <div className="mb-6">
        <h1 className="font-serif text-2xl font-semibold tracking-tight text-foreground">
          个人设置
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          当前用户：
          <span className="font-medium text-foreground">{user.username}</span>
        </p>
      </div>

      <form
        onSubmit={handleSave}
        className="space-y-5 rounded-2xl border border-border/60 bg-card/80 p-6 shadow-sm backdrop-blur-sm"
      >
        <div>
          <label className="mb-2 block text-sm font-medium text-foreground">
            默认出行风格
          </label>
          <select
            value={prefs.defaultStyle ?? ''}
            onChange={(e) =>
              setPrefs((p) => ({ ...p, defaultStyle: e.target.value || null }))
            }
            className={inputClass}
          >
            <option value="">不设置</option>
            {STYLE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">
            生成规划时自动带入，可在对话中覆盖
          </p>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-foreground">
            默认预算上限（元）
          </label>
          <input
            type="number"
            min={0}
            value={prefs.defaultBudget ?? ''}
            onChange={(e) =>
              setPrefs((p) => ({
                ...p,
                defaultBudget: e.target.value ? Number(e.target.value) : null,
              }))
            }
            placeholder="例如 8000"
            className={inputClass}
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-foreground">
            默认偏好
          </label>
          <input
            type="text"
            value={prefs.defaultPreference ?? ''}
            onChange={(e) =>
              setPrefs((p) => ({
                ...p,
                defaultPreference: e.target.value || null,
              }))
            }
            placeholder="例如 美食、自然风光、亲子..."
            className={inputClass}
          />
        </div>

        {msg && (
          <p className="rounded-lg border border-green-600/20 bg-green-500/10 px-3 py-2 text-sm text-green-700">
            {msg}
          </p>
        )}
        {err && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {err}
          </p>
        )}

        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-primary px-6 py-2.5 font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary/90 hover:shadow-md disabled:opacity-50"
        >
          {saving ? '保存中...' : '保存偏好'}
        </button>
      </form>
    </div>
  );
}
