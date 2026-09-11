import { Link, Outlet } from 'react-router-dom';
import { Plane, LogIn, User as UserIcon } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

/**
 * 公共布局：顶部导航栏 + 主体内容区
 * Phase16：导航栏右侧增加登录入口 / 用户菜单
 */
export function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto flex h-16 items-center px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <Plane className="h-5 w-5" />
            <span>旅行规划助手</span>
          </Link>
          <nav className="ml-8 flex items-center gap-6">
            <Link
              to="/"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              新建规划
            </Link>
            <Link
              to="/plans"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              历史记录
            </Link>
          </nav>

          {/* Phase16：右侧用户区 */}
          <div className="ml-auto flex items-center gap-3">
            {user ? (
              <>
                <Link
                  to="/profile"
                  className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  <UserIcon className="h-4 w-4" />
                  <span>{user.username}</span>
                </Link>
                <button
                  onClick={logout}
                  className="text-sm text-muted-foreground hover:text-red-500 transition-colors"
                >
                  退出
                </button>
              </>
            ) : (
              <Link
                to="/login"
                className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                <LogIn className="h-4 w-4" />
                <span>登录</span>
              </Link>
            )}
          </div>
        </div>
      </header>
      <main className="container mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
