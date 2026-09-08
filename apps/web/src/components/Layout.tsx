import { Link, Outlet } from 'react-router-dom';
import { Plane } from 'lucide-react';

/**
 * 公共布局：顶部导航栏 + 主体内容区
 */
export function Layout() {
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
        </div>
      </header>
      <main className="container mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
