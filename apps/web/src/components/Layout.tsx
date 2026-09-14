import { Link, Outlet } from 'react-router-dom';
import { Plane, LogIn, Map, Compass } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

/**
 * 公共布局：玻璃态导航栏 + 主体内容区
 * Phase16：导航栏右侧增加登录入口 / 用户菜单
 * 设计改造：Wanderlust Editorial 风格
 */
export function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="app-bg min-h-screen">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="container mx-auto flex h-16 items-center px-4">
          <Link to="/" className="group flex items-center gap-2.5 font-semibold">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-md transition-transform group-hover:rotate-12">
              <Compass className="h-5 w-5" />
            </span>
            <span className="font-serif text-lg tracking-tight">
              Wanderlust
            </span>
          </Link>
          <nav className="ml-10 flex items-center gap-1">
            <Link
              to="/"
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Map className="h-4 w-4" />
              新建规划
            </Link>
            <Link
              to="/plans"
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Plane className="h-4 w-4" />
              历史记录
            </Link>
          </nav>

          {/* Phase16：右侧用户区 */}
          <div className="ml-auto flex items-center gap-3">
            {user ? (
              <>
                <Link
                  to="/profile"
                  className="flex items-center gap-2 rounded-full border border-border/60 bg-card/60 py-1 pl-1 pr-3 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent/70 text-xs font-semibold text-accent-foreground">
                    {user.username.charAt(0).toUpperCase()}
                  </span>
                  <span>{user.username}</span>
                </Link>
                <button
                  onClick={logout}
                  className="rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  退出
                </button>
              </>
            ) : (
              <Link
                to="/login"
                className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary/90 hover:shadow-md"
              >
                <LogIn className="h-4 w-4" />
                <span>登录</span>
              </Link>
            )}
          </div>
        </div>
      </header>
      <main className="container mx-auto px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
