/**
 * Phase16 新增：认证状态 Context
 * 管理登录态、Token、用户信息
 */
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import {
  login as apiLogin,
  register as apiRegister,
  getCurrentUser,
  setToken as saveToken,
  clearToken as removeToken,
  getToken,
  type UserInfo,
} from '../api/client';

interface AuthContextValue {
  user: UserInfo | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);

  // 页面加载时恢复登录态
  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    getCurrentUser()
      .then((u) => setUser(u))
      .catch(() => {
        // Token 无效，清除
        removeToken();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const { token } = await apiLogin(username, password);
    saveToken(token);
    const u = await getCurrentUser();
    setUser(u);
  }, []);

  const register = useCallback(async (username: string, password: string) => {
    const { token } = await apiRegister(username, password);
    saveToken(token);
    const u = await getCurrentUser();
    setUser(u);
  }, []);

  const logout = useCallback(() => {
    removeToken();
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    try {
      const u = await getCurrentUser();
      setUser(u);
    } catch {
      // ignore
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth 必须在 AuthProvider 内使用');
  }
  return ctx;
}
