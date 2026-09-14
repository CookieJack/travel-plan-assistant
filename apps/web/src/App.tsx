import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { PlanPage } from './pages/PlanPage';
import { PlansPage } from './pages/PlansPage';
import { PlanDetailPage } from './pages/PlanDetailPage';
import LoginPage from './pages/LoginPage';
import ProfilePage from './pages/ProfilePage';
import { AuthProvider } from './context/AuthContext';

/**
 * 应用根组件：路由配置
 * Phase16：包裹 AuthProvider，新增 /login、/profile 路由
 */
export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* 登录页：独立布局（不显示导航栏） */}
          <Route path="/login" element={<LoginPage />} />

          {/* 带导航栏的页面 */}
          <Route element={<Layout />}>
            <Route path="/" element={<PlanPage />} />
            <Route path="/plans" element={<PlansPage />} />
            <Route path="/plans/:id" element={<PlanDetailPage />} />
            <Route path="/profile" element={<ProfilePage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
