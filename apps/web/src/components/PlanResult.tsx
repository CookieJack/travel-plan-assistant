import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import type { TravelState } from '@travel/shared';
import type { JsonPlanResponse } from '@/api/client';

interface PlanResultProps {
  result: JsonPlanResponse;
}

/**
 * 规划结果展示组件
 * 使用 Tabs 分区域展示：概览、机票、酒店、行程、预算
 */
export function PlanResult({ result }: PlanResultProps) {
  const { request, flights, hotels, activities, budget, summary } = result;

  return (
    <Tabs defaultValue="overview" className="w-full">
      <TabsList className="grid w-full grid-cols-5">
        <TabsTrigger value="overview">概览</TabsTrigger>
        <TabsTrigger value="flights">机票</TabsTrigger>
        <TabsTrigger value="hotels">酒店</TabsTrigger>
        <TabsTrigger value="activities">行程</TabsTrigger>
        <TabsTrigger value="budget">预算</TabsTrigger>
      </TabsList>

      {/* 概览 */}
      <TabsContent value="overview">
        <Card>
          <CardHeader>
            <CardTitle>规划概览</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">目的地</span>
              <span>{request.destination}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">出行日期</span>
              <span>{request.travelDate}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">行程天数</span>
              <span>{request.days} 天</span>
            </div>
            {request.travel_style && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">出行风格</span>
                <span>{request.travel_style}</span>
              </div>
            )}
            {request.user_preference && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">用户偏好</span>
                <span>{request.user_preference}</span>
              </div>
            )}
            {typeof request.budget_limit === 'number' && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">预算上限</span>
                <span>¥{request.budget_limit}</span>
              </div>
            )}
            {budget && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">预估总费用</span>
                <span className="font-medium">¥{budget.total}</span>
              </div>
            )}
            {budget && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">预算状态</span>
                <span className={budget.overBudget ? 'text-destructive' : 'text-green-600'}>
                  {budget.overBudget ? '超出预算' : '预算充足'}
                </span>
              </div>
            )}
            {summary && (
              <div className="pt-4 border-t">
                <p className="text-muted-foreground mb-2">规划摘要</p>
                <p className="whitespace-pre-wrap">{summary}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* 机票 */}
      <TabsContent value="flights">
        <Card>
          <CardHeader>
            <CardTitle>机票方案</CardTitle>
          </CardHeader>
          <CardContent>
            {flights && flights.options.length > 0 ? (
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
            <CardTitle>酒店方案</CardTitle>
          </CardHeader>
          <CardContent>
            {hotels && hotels.options.length > 0 ? (
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
            <CardTitle>每日行程</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {activities && activities.itinerary.length > 0 ? (
              activities.itinerary.map((day) => (
                <div key={day.day}>
                  <h4 className="font-semibold mb-2">第 {day.day} 天</h4>
                  <ul className="space-y-2">
                    {day.activities.map((a, i) => (
                      <li key={i} className="text-sm border-l-2 border-muted pl-3 py-1">
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
            <CardTitle>预算汇总</CardTitle>
          </CardHeader>
          <CardContent>
            {budget ? (
              <div className="space-y-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 pr-4">类别</th>
                        <th className="py-2 pr-4">描述</th>
                        <th className="py-2 pr-4 text-right">金额</th>
                      </tr>
                    </thead>
                    <tbody>
                      {budget.breakdown.map((item, i) => (
                        <tr key={i} className="border-b">
                          <td className="py-2 pr-4">{item.category}</td>
                          <td className="py-2 pr-4">{item.description}</td>
                          <td className="py-2 pr-4 text-right">¥{item.amount}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={2} className="py-2 pr-4 font-semibold">总计</td>
                        <td className="py-2 pr-4 text-right font-semibold">¥{budget.total}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {budget.overBudget && (
                  <div className="rounded-md bg-destructive/10 p-4 space-y-2">
                    <p className="text-destructive font-medium">⚠️ 预算告警：{budget.warning}</p>
                    {budget.suggestions && budget.suggestions.length > 0 && (
                      <div>
                        <p className="text-sm font-medium mb-1">调整建议：</p>
                        <ul className="list-disc list-inside text-sm space-y-1">
                          {budget.suggestions.map((s, i) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
                {!budget.overBudget && typeof request.budget_limit === 'number' && (
                  <p className="text-sm text-green-600">
                    ✅ 预算充足，剩余 ¥{request.budget_limit - budget.total} 可自由支配
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">暂无数据</p>
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
