import { useState } from 'react';
import type { TravelRequest } from '@travel/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { RunMode } from '@/api/client';

/** 表单状态 */
interface FormState {
  destination: string;
  days: string;
  travelDate: string;
  budget_limit: string;
  user_preference: string;
  travel_style: string;
}

/** 多城市条目 */
interface CityEntry {
  city: string;
  days: string;
}

const initialForm: FormState = {
  destination: '',
  days: '',
  travelDate: '',
  budget_limit: '',
  user_preference: '',
  travel_style: '',
};

interface PlanFormProps {
  onSubmit: (request: TravelRequest, mode: RunMode) => void;
  loading: boolean;
}

/**
 * 规划表单组件
 */
export function PlanForm({ onSubmit, loading }: PlanFormProps) {
  const [form, setForm] = useState<FormState>(initialForm);
  const [mode, setMode] = useState<RunMode>('mock');
  const [error, setError] = useState<string>('');
  // Phase15 新增：多城市
  const [multiCity, setMultiCity] = useState(false);
  const [cities, setCities] = useState<CityEntry[]>([
    { city: '', days: '' },
    { city: '', days: '' },
  ]);

  const handleChange = (field: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError('');
  };

  const handleCityChange = (idx: number, field: keyof CityEntry, value: string) => {
    setCities((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, [field]: value } : c)),
    );
    setError('');
  };

  const addCity = () => {
    setCities((prev) => [...prev, { city: '', days: '' }]);
  };

  const removeCity = (idx: number) => {
    setCities((prev) => prev.filter((_, i) => i !== idx));
  };

  const toggleMultiCity = () => {
    setMultiCity((prev) => !prev);
    setError('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!form.travelDate.trim()) {
      setError('请选择出行日期');
      return;
    }

    // 构造请求体
    const request: TravelRequest = {
      destination: '',
      days: 0,
      travelDate: form.travelDate.trim(),
    };

    if (multiCity) {
      // 多城市校验
      if (cities.length < 2) {
        setError('多城市至少需要 2 个城市');
        return;
      }
      const destinations = cities.map((c) => {
        const cityName = c.city.trim();
        const cityDays = Number(c.days);
        if (!cityName) {
          setError('请填写所有城市名称');
          return null;
        }
        if (!c.days || !Number.isInteger(cityDays) || cityDays <= 0) {
          setError(`请为「${cityName}」输入有效的天数（正整数）`);
          return null;
        }
        return { city: cityName, days: cityDays };
      });
      if (destinations.some((d) => d === null)) return;

      request.destinations = destinations as { city: string; days: number }[];
      request.destination = destinations[0]!.city;
      request.days = destinations.reduce((sum, d) => sum + d!.days, 0);
    } else {
      // 单城市校验
      if (!form.destination.trim()) {
        setError('请输入目的地');
        return;
      }
      const days = Number(form.days);
      if (!form.days || !Number.isInteger(days) || days <= 0) {
        setError('请输入有效的出行天数（正整数）');
        return;
      }
      request.destination = form.destination.trim();
      request.days = days;
    }

    if (form.budget_limit) {
      const budget = Number(form.budget_limit);
      if (budget <= 0) {
        setError('预算上限必须为正数');
        return;
      }
      request.budget_limit = budget;
    }
    if (form.user_preference.trim()) {
      request.user_preference = form.user_preference.trim();
    }
    if (form.travel_style) {
      request.travel_style = form.travel_style;
    }

    onSubmit(request, mode);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Phase15 新增：多城市开关 */}
      <div className="flex items-center justify-between rounded-md border p-3">
        <div>
          <Label className="text-sm font-medium">多城市行程</Label>
          <p className="text-xs text-muted-foreground">开启后可添加多个目的地城市</p>
        </div>
        <Button
          type="button"
          variant={multiCity ? 'default' : 'outline'}
          size="sm"
          onClick={toggleMultiCity}
          disabled={loading}
        >
          {multiCity ? '已开启' : '单城市'}
        </Button>
      </div>

      {multiCity ? (
        <div className="space-y-3">
          <Label>目的地城市列表 *</Label>
          {cities.map((city, idx) => (
            <div key={idx} className="flex gap-2">
              <Input
                placeholder="城市名，如：北京"
                value={city.city}
                onChange={(e) => handleCityChange(idx, 'city', e.target.value)}
                disabled={loading}
              />
              <Input
                type="number"
                min={1}
                placeholder="天数"
                value={city.days}
                onChange={(e) => handleCityChange(idx, 'days', e.target.value)}
                disabled={loading}
                className="w-24"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => removeCity(idx)}
                disabled={loading || cities.length <= 2}
              >
                −
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addCity} disabled={loading}>
            + 添加城市
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="destination">目的地 *</Label>
          <Input
            id="destination"
            placeholder="如：东京"
            value={form.destination}
            onChange={(e) => handleChange('destination', e.target.value)}
            disabled={loading}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {!multiCity && (
          <div className="space-y-2">
            <Label htmlFor="days">出行天数 *</Label>
            <Input
              id="days"
              type="number"
              min={1}
              placeholder="如：5"
              value={form.days}
              onChange={(e) => handleChange('days', e.target.value)}
              disabled={loading}
            />
          </div>
        )}
        <div className={`space-y-2 ${multiCity ? 'col-span-2' : ''}`}>
          <Label htmlFor="travelDate">出行日期 *</Label>
          <Input
            id="travelDate"
            type="date"
            value={form.travelDate}
            onChange={(e) => handleChange('travelDate', e.target.value)}
            disabled={loading}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="budget_limit">预算上限（元）</Label>
        <Input
          id="budget_limit"
          type="number"
          min={1}
          placeholder="如：8000"
          value={form.budget_limit}
          onChange={(e) => handleChange('budget_limit', e.target.value)}
          disabled={loading}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="user_preference">用户偏好</Label>
        <Input
          id="user_preference"
          placeholder="如：美食、自然风光、博物馆"
          value={form.user_preference}
          onChange={(e) => handleChange('user_preference', e.target.value)}
          disabled={loading}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="travel_style">出行风格</Label>
        <Select
          value={form.travel_style}
          onValueChange={(v) => handleChange('travel_style', v)}
        >
          <SelectTrigger id="travel_style" disabled={loading}>
            <SelectValue placeholder="请选择出行风格" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="穷游">穷游</SelectItem>
            <SelectItem value="舒适">舒适</SelectItem>
            <SelectItem value="轻奢">轻奢</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="mode">运行模式 *</Label>
        <Select
          value={mode}
          onValueChange={(v) => setMode(v as RunMode)}
        >
          <SelectTrigger id="mode" disabled={loading}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="mock">Mock（模拟数据）</SelectItem>
            <SelectItem value="llm">LLM（真实大模型）</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? '规划生成中...' : '生成规划方案'}
      </Button>
    </form>
  );
}
