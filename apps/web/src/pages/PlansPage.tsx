import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { PlanCard } from '@/components/PlanCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { listPlans, type PlanListItem } from '@/api/client';

const PAGE_SIZE = 10;

/**
 * 历史列表页：卡片列表 + 目的地过滤 + 分页
 */
export function PlansPage() {
  const [items, setItems] = useState<PlanListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [destination, setDestination] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await listPlans(page, PAGE_SIZE, destination);
      setItems(data.items);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : '查询失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [page, destination]);

  const handleSearch = () => {
    setPage(1);
    setDestination(searchInput);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">历史规划记录</h1>
      </div>

      {/* 搜索栏 */}
      <div className="flex gap-2">
        <Input
          placeholder="按目的地搜索..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSearch();
          }}
        />
        <Button onClick={handleSearch} variant="outline">
          <Search className="h-4 w-4" />
          搜索
        </Button>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 p-4 text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          加载中...
        </div>
      ) : items.length === 0 ? (
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          暂无历史规划记录
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {items.map((plan) => (
              <PlanCard key={plan.id} plan={plan} />
            ))}
          </div>

          {/* 分页 */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              第 {page} 页 / 共 {total} 条
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                上一页
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                下一页
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
