/**
 * Phase16 新增：个人设置页面
 * 修改用户默认出行风格、预算上限、偏好
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
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        加载中...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-2xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">个人设置</h1>
        <p className="text-sm text-slate-500 mb-6">
          当前用户：<span className="font-medium text-slate-700">{user.username}</span>
        </p>

        <form onSubmit={handleSave} className="bg-white rounded-2xl shadow-sm p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              默认出行风格
            </label>
            <select
              value={prefs.defaultStyle ?? ''}
              onChange={(e) =>
                setPrefs((p) => ({ ...p, defaultStyle: e.target.value || null }))
              }
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="">不设置</option>
              {STYLE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-400 mt-1">生成规划时自动带入，可在表单中覆盖</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
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
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
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
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {msg && <p className="text-sm text-green-600 bg-green-50 px-3 py-2 rounded-lg">{msg}</p>}
          {err && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{err}</p>}

          <button
            type="submit"
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-medium py-2.5 px-6 rounded-lg transition"
          >
            {saving ? '保存中...' : '保存偏好'}
          </button>
        </form>
      </div>
    </div>
  );
}
