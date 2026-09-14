import { useState } from 'react';
import {
  MapPin,
  Calendar,
  Clock,
  Wallet,
  Sparkles,
  Briefcase,
  Heart,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import type { TravelState } from '@travel/shared';
import type { JsonPlanResponse } from '@/api/client';
import { ToolCallList } from './ToolCallList';

interface PlanResultProps {
  result: JsonPlanResponse;
  /** 是否显示反馈修订区域（默认显示） */
  showRevise?: boolean;
  /** 提交反馈回调 */
  onRevise?: (feedback: string) => void;
  /** 是否正在修订 */
  revising?: boolean;
  /** 当前展示的是否为修订版 */
  isRevised?: boolean;
  /** 返回原规划回调 */
  onBackToOriginal?: () => void;
}

/**
 * 规划结果展示组件
 * 使用 Tabs 分区域展示：概览、机票、酒店、行程、预算
 * Phase14 新增：反馈修订区域
 */
export function PlanResult({
  result,
  showRevise = true,
  onRevise,
  revising = false,
  isRevised = false,
  onBackToOriginal,
}: PlanResultProps) {
  const { request, flights, hotels, activities, budget, summary, toolCalls, cityPlans } = result;
  const isMultiCity = cityPlans && cityPlans.length > 1;
  const [feedback, setFeedback] = useState('');

  const handleSubmit = () => {
    if (!feedback.trim() || !onRevise || revising) return;
    onRevise(feedback.trim());
    setFeedback('');
  };

  return (
    <div className="space-y-4 animate-fade-in-up">
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="tabs-list-editorial grid w-full grid-cols-6">
          <TabsTrigger value="overview">概览</TabsTrigger>
          <TabsTrigger value="flights">机票</TabsTrigger>
          <TabsTrigger value="hotels">酒店</TabsTrigger>
          <TabsTrigger value="activities">行程</TabsTrigger>
          <TabsTrigger value="budget">预算</TabsTrigger>
          <TabsTrigger value="process">执行过程</TabsTrigger>
        </TabsList>

        {/* 概览 */}
        <TabsContent value="overview">
          <Card>
            <CardHeader>
              <CardTitle className="font-serif text-xl">规划概览</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3 text-sm">
                <MapPin className="h-4 w-4 shrink-0 text-primary" />
                <span className="text-muted-foreground w-20">目的地</span>
                <span className="font-medium">
                  {isMultiCity
                    ? cityPlans!.map((c) => c.city).join(' → ')
                    : request.destination}
                </span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Calendar className="h-4 w-4 shrink-0 text-primary" />
                <span className="text-muted-foreground w-20">出行日期</span>
                <span className="font-medium">{request.travelDate}</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Clock className="h-4 w-4 shrink-0 text-primary" />
                <span className="text-muted-foreground w-20">行程天数</span>
                <span className="font-medium">{request.days} 天</span>
              </div>
              {request.travel_style && (
                <div className="flex items-center gap-3 text-sm">
                  <Briefcase className="h-4 w-4 shrink-0 text-primary" />
                  <span className="text-muted-foreground w-20">出行风格</span>
                  <span className="font-medium">{request.travel_style}</span>
                </div>
              )}
              {request.user_preference && (
                <div className="flex items-center gap-3 text-sm">
                  <Heart className="h-4 w-4 shrink-0 text-primary" />
                  <span className="text-muted-foreground w-20">用户偏好</span>
                  <span className="font-medium">{request.user_preference}</span>
                </div>
              )}
              {typeof request.budget_limit === 'number' && (
                <div className="flex items-center gap-3 text-sm">
                  <Wallet className="h-4 w-4 shrink-0 text-primary" />
                  <span className="text-muted-foreground w-20">预算上限</span>
                  <span className="font-medium">¥{request.budget_limit}</span>
                </div>
              )}
              {budget && (
                <div className="flex items-center gap-3 text-sm">
                  <span className="h-4 w-4 shrink-0" />
                  <span className="text-muted-foreground w-20">预估总费用</span>
                  <span className="font-semibold text-primary">¥{budget.total}</span>
                </div>
              )}
              {budget && (
                <div className="flex items-center gap-3 text-sm">
                  <span className="h-4 w-4 shrink-0" />
                  <span className="text-muted-foreground w-20">预算状态</span>
                  <span
                    className={
                      budget.overBudget ? 'text-destructive font-medium' : 'text-green-600 font-medium'
                    }
                  >
                    {budget.overBudget ? '超出预算' : '预算充足'}
                  </span>
                </div>
              )}
              {summary && (
                <div className="mt-5 rounded-xl bg-secondary/50 p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                    <Sparkles className="h-4 w-4 text-primary" />
                    规划摘要
                  </div>
                  <p className="text-sm leading-relaxed text-foreground/80 whitespace-pre-wrap">
                    {summary}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 机票 */}
        <TabsContent value="flights">
          <Card>
            <CardHeader>
              <CardTitle className="font-serif text-xl">机票方案</CardTitle>
            </CardHeader>
            <CardContent>
              {isMultiCity ? (
                <div className="space-y-6">
                  {cityPlans!.map((city, idx) => (
                    <div key={idx}>
                      <h4 className="font-semibold mb-2">第 {idx + 1} 站：{city.city}（{city.days} 天）</h4>
                      {city.flights && city.flights.options.length > 0 ? (
                        <div className="overflow-x-auto rounded-xl border border-border/50">
                          <table className="w-full text-sm">
                            <thead className="bg-secondary/60">
                              <tr className="text-left text-muted-foreground">
                                <th className="py-2 pr-4">方案</th>
                                <th className="py-2 pr-4">航司</th>
                                <th className="py-2 pr-4">航班号</th>
                                <th className="py-2 pr-4">出发</th>
                                <th className="py-2 pr-4">到达</th>
                                <th className="py-2 pr-4">舱位</th>
                                <th className="py-2 pr-4">价格</th>
                              </tr>
                            </thead>
                            <tbody>
                              {city.flights.options.map((f, i) => (
                                <tr key={i} className="border-b border-border/40 last:border-0 transition-colors hover:bg-secondary/30">
                                  <td className="py-2 pr-4">{i + 1}</td>
                                  <td className="py-2 pr-4">{f.airline}</td>
                                  <td className="py-2 pr-4">{f.flightNo}</td>
                                  <td className="py-2 pr-4">{f.departTime}</td>
                                  <td className="py-2 pr-4">{f.arriveTime}</td>
                                  <td className="py-2 pr-4">{f.cabin}</td>
                                  <td className="py-2 pr-4 font-medium">¥{f.price}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">暂无数据</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : flights && flights.options.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 pr-4">方案</th>
                        <th className="py-2 pr-4">航司</th>
                        <th className="py-2 pr-4">航班号</th>
                        <th className="py-2 pr-4">出发</th>
                        <th className="py-2 pr-4">到达</th>
                        <th className="py-2 pr-4">舱位</th>
                        <th className="py-2 pr-4">价格</th>
                      </tr>
                    </thead>
                    <tbody>
                      {flights.options.map((f, i) => (
                        <tr key={i} className="border-b">
                          <td className="py-2 pr-4">{i + 1}</td>
                          <td className="py-2 pr-4">{f.airline}</td>
                          <td className="py-2 pr-4">{f.flightNo}</td>
                          <td className="py-2 pr-4">{f.departTime}</td>
                          <td className="py-2 pr-4">{f.arriveTime}</td>
                          <td className="py-2 pr-4">{f.cabin}</td>
                          <td className="py-2 pr-4 font-medium">¥{f.price}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">暂无数据</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 酒店 */}
        <TabsContent value="hotels">
          <Card>
            <CardHeader>
              <CardTitle className="font-serif text-xl">酒店方案</CardTitle>
            </CardHeader>
            <CardContent>
              {isMultiCity ? (
                <div className="space-y-6">
                  {cityPlans!.map((city, idx) => (
                    <div key={idx}>
                      <h4 className="font-semibold mb-2">第 {idx + 1} 站：{city.city}（{city.days} 天）</h4>
                      {city.hotels && city.hotels.options.length > 0 ? (
                        <div className="overflow-x-auto rounded-xl border border-border/50">
                          <table className="w-full text-sm">
                            <thead className="bg-secondary/60">
                              <tr className="text-left text-muted-foreground">
                                <th className="py-2 pr-4">方案</th>
                                <th className="py-2 pr-4">酒店</th>
                                <th className="py-2 pr-4">星级</th>
                                <th className="py-2 pr-4">房型</th>
                                <th className="py-2 pr-4">价格/晚</th>
                                <th className="py-2 pr-4">位置</th>
                              </tr>
                            </thead>
                            <tbody>
                              {city.hotels.options.map((h, i) => (
                                <tr key={i} className="border-b border-border/40 last:border-0 transition-colors hover:bg-secondary/30">
                                  <td className="py-2 pr-4">{i + 1}</td>
                                  <td className="py-2 pr-4">{h.name}</td>
                                  <td className="py-2 pr-4">{h.star}星</td>
                                  <td className="py-2 pr-4">{h.roomType}</td>
                                  <td className="py-2 pr-4 font-medium">¥{h.pricePerNight}</td>
                                  <td className="py-2 pr-4">{h.location}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">暂无数据</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : hotels && hotels.options.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 pr-4">方案</th>
                        <th className="py-2 pr-4">酒店</th>
                        <th className="py-2 pr-4">星级</th>
                        <th className="py-2 pr-4">房型</th>
                        <th className="py-2 pr-4">价格/晚</th>
                        <th className="py-2 pr-4">位置</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hotels.options.map((h, i) => (
                        <tr key={i} className="border-b">
                          <td className="py-2 pr-4">{i + 1}</td>
                          <td className="py-2 pr-4">{h.name}</td>
                          <td className="py-2 pr-4">{h.star}星</td>
                          <td className="py-2 pr-4">{h.roomType}</td>
                          <td className="py-2 pr-4 font-medium">¥{h.pricePerNight}</td>
                          <td className="py-2 pr-4">{h.location}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">暂无数据</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 每日行程 */}
        <TabsContent value="activities">
          <Card>
            <CardHeader>
              <CardTitle className="font-serif text-xl">每日行程</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {isMultiCity ? (
                cityPlans!.map((city, idx) => (
                  <div key={idx}>
                    <h4 className="font-semibold mb-2">第 {idx + 1} 站：{city.city}（{city.days} 天）</h4>
                    {city.activities && city.activities.itinerary.length > 0 ? (
                      <div className="space-y-4">
                        {city.activities.itinerary.map((day) => (
                          <div key={day.day}>
                            <h5 className="font-medium mb-2 text-muted-foreground">第 {day.day} 天</h5>
                            <ul className="space-y-2">
                              {day.activities.map((a, i) => (
                                <li key={i} className="rounded-lg border-l-2 border-primary/40 bg-secondary/30 py-2 pl-3 pr-2">
                                  <div className="flex justify-between">
                                    <span className="font-medium">{a.time} {a.name}</span>
                                    <span className="text-muted-foreground">¥{a.cost}</span>
                                  </div>
                                  <p className="text-muted-foreground text-xs mt-1">{a.description}</p>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">暂无数据</p>
                    )}
                  </div>
                ))
              ) : activities && activities.itinerary.length > 0 ? (
                activities.itinerary.map((day) => (
                  <div key={day.day}>
                    <h4 className="font-semibold mb-2">第 {day.day} 天</h4>
                    <ul className="space-y-2">
                      {day.activities.map((a, i) => (
                        <li key={i} className="rounded-lg border-l-2 border-primary/40 bg-secondary/30 py-2 pl-3 pr-2">
                          <div className="flex justify-between">
                            <span className="font-medium">{a.time} {a.name}</span>
                            <span className="text-muted-foreground">¥{a.cost}</span>
                          </div>
                          <p className="text-muted-foreground text-xs mt-1">{a.description}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">暂无数据</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 预算 */}
        <TabsContent value="budget">
          <Card>
            <CardHeader>
              <CardTitle className="font-serif text-xl">预算汇总</CardTitle>
            </CardHeader>
            <CardContent>
              {budget ? (
                <div className="space-y-4">
                  <div className="overflow-x-auto rounded-xl border border-border/50">
                    <table className="w-full text-sm">
                      <thead className="bg-secondary/60">
                        <tr className="text-left text-muted-foreground">
                          <th className="px-4 py-2.5">类别</th>
                          <th className="px-4 py-2.5">描述</th>
                          <th className="px-4 py-2.5 text-right">金额</th>
                        </tr>
                      </thead>
                      <tbody>
                        {budget.breakdown.map((item, i) => (
                          <tr key={i} className="border-b border-border/40 last:border-0 transition-colors hover:bg-secondary/30">
                            <td className="px-4 py-2.5">{item.category}</td>
                            <td className="px-4 py-2.5">{item.description}</td>
                            <td className="px-4 py-2.5 text-right font-medium">¥{item.amount}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-secondary/40">
                        <tr>
                          <td colSpan={2} className="px-4 py-2.5 font-semibold">总计</td>
                          <td className="px-4 py-2.5 text-right font-semibold text-primary">¥{budget.total}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {budget.overBudget && (
                    <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 space-y-2">
                      <p className="font-medium text-destructive">⚠️ 预算告警：{budget.warning}</p>
                      {budget.suggestions && budget.suggestions.length > 0 && (
                        <div>
                          <p className="mb-1 text-sm font-medium text-destructive/80">调整建议：</p>
                          <ul className="list-disc space-y-1 pl-5 text-sm text-foreground/80">
                            {budget.suggestions.map((s, i) => (
                              <li key={i}>{s}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                  {!budget.overBudget && typeof request.budget_limit === 'number' && (
                    <div className="rounded-xl border border-green-600/20 bg-green-500/10 p-4 text-sm text-green-700">
                      ✅ 预算充足，剩余 <span className="font-semibold">¥{request.budget_limit - budget.total}</span> 可自由支配
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">暂无数据</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 执行过程 */}
        <TabsContent value="process">
          <Card>
            <CardHeader>
              <CardTitle className="font-serif text-xl">执行过程</CardTitle>
            </CardHeader>
            <CardContent>
              {toolCalls && toolCalls.length > 0 ? (
                <ToolCallList toolCalls={toolCalls} />
              ) : (
                <p className="text-sm text-muted-foreground">暂无工具调用记录</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Phase14 新增：反馈修订区域 */}
      {showRevise && (
        <Card className="border-primary/20">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="font-serif text-xl">反馈修订</span>
              {isRevised && onBackToOriginal && (
                <Button variant="outline" size="sm" onClick={onBackToOriginal}>
                  返回原规划
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              placeholder="对当前规划不满意？输入你的修改意见，例如：预算太高了，换个便宜点的酒店"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              maxLength={1000}
              rows={3}
              disabled={revising}
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {feedback.length}/1000
              </span>
              <Button onClick={handleSubmit} disabled={!feedback.trim() || revising}>
                {revising ? '修订中...' : '提交反馈并重新生成'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
