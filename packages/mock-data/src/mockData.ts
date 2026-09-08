/**
 * 全量 Mock 数据
 * 本阶段不调用任何真实接口，所有数据本地模拟生成
 * Phase1 增强：根据用户预算、出行风格、偏好动态推理生成差异化方案
 */
import type {
  FlightOption,
  HotelOption,
  DayItinerary,
  TravelRequest,
} from '@travel/shared';

/** 判断是否为低预算档位 */
function isLowBudget(request: TravelRequest): boolean {
  if (request.travel_style === '穷游') return true;
  if (typeof request.budget_limit === 'number') {
    // 预算上限偏低（按天数粗略估算）
    const perDay = request.budget_limit / Math.max(request.days, 1);
    return perDay < 1500;
  }
  return false;
}

/** 判断是否为高预算档位 */
function isHighBudget(request: TravelRequest): boolean {
  if (request.travel_style === '轻奢') return true;
  if (typeof request.budget_limit === 'number') {
    const perDay = request.budget_limit / Math.max(request.days, 1);
    return perDay >= 3500;
  }
  return false;
}

/** 生成模拟机票方案 */
export function mockFlights(request: TravelRequest): FlightOption[] {
  const { destination } = request;
  const low = isLowBudget(request);
  const high = isHighBudget(request);

  if (low) {
    // 穷游/低预算：经济舱、低价、红眼/折扣航班
    return [
      {
        airline: '模拟航空',
        flightNo: 'MN1234',
        departTime: '06:15',
        arriveTime: '09:30',
        price: 680,
        cabin: '经济舱',
      },
      {
        airline: '云端航空',
        flightNo: 'CL5678',
        departTime: '23:40',
        arriveTime: '03:10',
        price: 520,
        cabin: '经济舱',
      },
      {
        airline: '模拟航空',
        flightNo: 'MN9012',
        departTime: '19:00',
        arriveTime: '22:15',
        price: 760,
        cabin: '经济舱',
      },
    ].map((f) => ({ ...f, airline: `${f.airline}（${destination}航线）` }));
  }

  if (high) {
    // 轻奢/高预算：商务舱、高价、优质时段
    return [
      {
        airline: '模拟航空',
        flightNo: 'MN1234',
        departTime: '09:30',
        arriveTime: '12:45',
        price: 4280,
        cabin: '商务舱',
      },
      {
        airline: '云端航空',
        flightNo: 'CL5678',
        departTime: '14:20',
        arriveTime: '17:50',
        price: 3960,
        cabin: '商务舱',
      },
      {
        airline: '模拟航空',
        flightNo: 'MN9012',
        departTime: '10:00',
        arriveTime: '13:20',
        price: 4580,
        cabin: '头等舱',
      },
    ].map((f) => ({ ...f, airline: `${f.airline}（${destination}航线）` }));
  }

  // 默认/舒适档：经济舱、适中价格
  return [
    {
      airline: '模拟航空',
      flightNo: 'MN1234',
      departTime: '08:30',
      arriveTime: '11:45',
      price: 1280,
      cabin: '经济舱',
    },
    {
      airline: '云端航空',
      flightNo: 'CL5678',
      departTime: '14:20',
      arriveTime: '17:50',
      price: 1560,
      cabin: '经济舱',
    },
    {
      airline: '模拟航空',
      flightNo: 'MN9012',
      departTime: '19:00',
      arriveTime: '22:15',
      price: 980,
      cabin: '经济舱',
    },
  ].map((f) => ({ ...f, airline: `${f.airline}（${destination}航线）` }));
}

/** 生成模拟酒店方案 */
export function mockHotels(request: TravelRequest): HotelOption[] {
  const { destination } = request;
  const low = isLowBudget(request);
  const high = isHighBudget(request);

  if (low) {
    // 穷游/低预算：经济型酒店
    return [
      {
        name: '青年旅舍',
        star: 2,
        roomType: '多人间床位',
        pricePerNight: 120,
        location: `${destination}老城区`,
      },
      {
        name: '经济快捷酒店',
        star: 3,
        roomType: '标准单人间',
        pricePerNight: 260,
        location: `${destination}地铁站附近`,
      },
      {
        name: '家庭旅馆',
        star: 2,
        roomType: '温馨大床房',
        pricePerNight: 180,
        location: `${destination}居民区`,
      },
    ];
  }

  if (high) {
    // 轻奢/高预算：高端酒店
    return [
      {
        name: '模拟大酒店',
        star: 5,
        roomType: '行政套房',
        pricePerNight: 2880,
        location: `${destination}市中心`,
      },
      {
        name: '云端奢华酒店',
        star: 5,
        roomType: '豪华大床房',
        pricePerNight: 1880,
        location: `${destination}江景/海景区`,
      },
      {
        name: '精品设计酒店',
        star: 4,
        roomType: '设计师套房',
        pricePerNight: 1580,
        location: `${destination}时尚商圈`,
      },
    ];
  }

  // 默认/舒适档
  return [
    {
      name: '模拟大酒店',
      star: 5,
      roomType: '豪华大床房',
      pricePerNight: 880,
      location: `${destination}市中心`,
    },
    {
      name: '舒适商旅酒店',
      star: 4,
      roomType: '标准双床房',
      pricePerNight: 520,
      location: `${destination}商圈附近`,
    },
    {
      name: '青年旅舍',
      star: 3,
      roomType: '多人间床位',
      pricePerNight: 180,
      location: `${destination}老城区`,
    },
  ];
}

/** 根据用户偏好生成单日活动模板 */
function preferenceActivities(
  preference: string | undefined,
  destination: string,
) {
  const p = (preference || '').trim();

  if (p.includes('博物馆') || p.includes('艺术') || p.includes('历史')) {
    return [
      {
        time: '09:00',
        name: `${destination}国家博物馆`,
        description: '参观馆藏文物与历史常设展，深度了解当地文化',
        cost: 80,
      },
      {
        time: '12:30',
        name: '博物馆附近特色午餐',
        description: '品尝当地老字号美食',
        cost: 100,
      },
      {
        time: '14:00',
        name: `${destination}现代美术馆`,
        description: '欣赏当代艺术特展与本地艺术家作品',
        cost: 60,
      },
      {
        time: '18:30',
        name: '历史街区夜游',
        description: '漫步老城街巷，感受历史氛围',
        cost: 0,
      },
    ];
  }

  if (p.includes('美食') || p.includes('吃')) {
    return [
      {
        time: '09:30',
        name: `${destination}早市美食探索`,
        description: '品尝当地特色早餐与小吃',
        cost: 50,
      },
      {
        time: '12:00',
        name: '老字号午宴',
        description: '体验招牌菜系与本地风味',
        cost: 200,
      },
      {
        time: '15:00',
        name: `${destination}美食街逛吃`,
        description: '街头小吃与甜品一网打尽',
        cost: 120,
      },
      {
        time: '19:00',
        name: '夜市晚餐',
        description: '感受烟火气与夜生活',
        cost: 150,
      },
    ];
  }

  if (p.includes('自然') || p.includes('风光') || p.includes('户外')) {
    return [
      {
        time: '08:00',
        name: `${destination}国家森林公园`,
        description: '徒步登山，呼吸新鲜空气',
        cost: 60,
      },
      {
        time: '12:30',
        name: '山野农家午餐',
        description: '品尝原生态农家菜',
        cost: 90,
      },
      {
        time: '14:30',
        name: `${destination}湖畔/海岸漫步`,
        description: '欣赏自然风光，拍照打卡',
        cost: 0,
      },
      {
        time: '18:00',
        name: '观景台看日落',
        description: '俯瞰城市与自然景观',
        cost: 30,
      },
    ];
  }

  if (p.includes('亲子') || p.includes('家庭') || p.includes('孩子')) {
    return [
      {
        time: '09:00',
        name: `${destination}主题乐园`,
        description: '亲子游乐设施，家庭欢乐时光',
        cost: 300,
      },
      {
        time: '12:30',
        name: '儿童友好餐厅午餐',
        description: '适合全家的健康餐饮',
        cost: 150,
      },
      {
        time: '14:30',
        name: `${destination}科技馆/水族馆`,
        description: '寓教于乐，孩子探索世界',
        cost: 120,
      },
      {
        time: '19:00',
        name: '亲子晚餐',
        description: '轻松愉快的家庭聚餐',
        cost: 180,
      },
    ];
  }

  // 默认：经典景点
  return [
    {
      time: '09:00',
      name: `${destination}经典景点游览`,
      description: `参观${destination}标志性景点，感受当地文化`,
      cost: 120,
    },
    {
      time: '12:30',
      name: '特色午餐',
      description: '品尝当地特色美食',
      cost: 80,
    },
    {
      time: '14:30',
      name: `${destination}深度游`,
      description: '小众景点探索，体验本地生活',
      cost: 60,
    },
    {
      time: '19:00',
      name: '夜景与晚餐',
      description: '欣赏城市夜景，享用晚餐',
      cost: 150,
    },
  ];
}

/** 生成模拟每日游玩行程 */
export function mockActivities(request: TravelRequest): DayItinerary[] {
  const { days, destination, user_preference } = request;
  const itinerary: DayItinerary[] = [];

  for (let day = 1; day <= days; day++) {
    itinerary.push({
      day,
      activities: preferenceActivities(user_preference, destination),
    });
  }
  return itinerary;
}
