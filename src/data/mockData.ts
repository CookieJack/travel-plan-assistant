/**
 * 全量 Mock 数据
 * 本阶段不调用任何真实接口，所有数据本地模拟生成
 */
import type {
  FlightOption,
  HotelOption,
  DayItinerary,
  TravelRequest,
} from '../types/travel.js';

/** 生成模拟机票方案 */
export function mockFlights(request: TravelRequest): FlightOption[] {
  const { destination } = request;
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
  return [
    {
      name: '模拟大酒店',
      star: 5,
      roomType: '豪华大床房',
      pricePerNight: 880,
      location: `${request.destination}市中心`,
    },
    {
      name: '舒适商旅酒店',
      star: 4,
      roomType: '标准双床房',
      pricePerNight: 520,
      location: `${request.destination}商圈附近`,
    },
    {
      name: '青年旅舍',
      star: 3,
      roomType: '多人间床位',
      pricePerNight: 180,
      location: `${request.destination}老城区`,
    },
  ];
}

/** 生成模拟每日游玩行程 */
export function mockActivities(request: TravelRequest): DayItinerary[] {
  const { days, destination } = request;
  const itinerary: DayItinerary[] = [];

  for (let day = 1; day <= days; day++) {
    itinerary.push({
      day,
      activities: [
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
      ],
    });
  }
  return itinerary;
}
