import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { PlanPage } from './pages/PlanPage';
import { PlansPage } from './pages/PlansPage';
import { PlanDetailPage } from './pages/PlanDetailPage';

/**
 * 应用根组件：路由配置
 */
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<PlanPage />} />
          <Route path="/plans" element={<PlansPage />} />
          <Route path="/plans/:id" element={<PlanDetailPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
