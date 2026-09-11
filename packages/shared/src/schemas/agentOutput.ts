import { z } from 'zod';
import type {
  FlightOption,
  HotelOption,
  DayItinerary,
  CostItem,
} from '../travel.js';

// ---- 机票输出 ----
const flightOptionSchema = z.object({
  airline: z.string(),
  flightNo: z.string(),
  departTime: z.string(),
  arriveTime: z.string(),
  price: z.number(),
  cabin: z.string(),
});

const flightOutputSchema = z.object({
  options: z.array(flightOptionSchema),
});

/** 校验机票 Agent 的 LLM 输出（签名与原 validateFlightOutput 一致） */
export function validateFlightOutput(data: unknown): data is { options: FlightOption[] } {
  return flightOutputSchema.safeParse(data).success;
}

// ---- 酒店输出 ----
const hotelOptionSchema = z.object({
  name: z.string(),
  star: z.number(),
  roomType: z.string(),
  pricePerNight: z.number(),
  location: z.string(),
});

const hotelOutputSchema = z.object({
  options: z.array(hotelOptionSchema),
});

export function validateHotelOutput(data: unknown): data is { options: HotelOption[] } {
  return hotelOutputSchema.safeParse(data).success;
}

// ---- 活动输出 ----
const activityItemSchema = z.object({
  time: z.string(),
  name: z.string(),
  description: z.string(),
  cost: z.number(),
});

const dayItinerarySchema = z.object({
  day: z.number(),
  activities: z.array(activityItemSchema),
});

const activitiesOutputSchema = z.object({
  itinerary: z.array(dayItinerarySchema),
});

export function validateActivitiesOutput(
  data: unknown,
): data is { itinerary: DayItinerary[] } {
  return activitiesOutputSchema.safeParse(data).success;
}

// ---- 预算输出 ----
const costItemSchema = z.object({
  category: z.string(),
  description: z.string(),
  amount: z.number(),
});

const budgetOutputSchema = z.object({
  total: z.number(),
  breakdown: z.array(costItemSchema),
  overBudget: z.boolean(),
  warning: z.string().nullable().optional(),
  suggestions: z.array(z.string()).nullable().optional(),
});

export function validateBudgetOutput(
  data: unknown,
): data is {
  total: number;
  breakdown: CostItem[];
  overBudget: boolean;
  warning?: string | null;
  suggestions?: string[] | null;
} {
  return budgetOutputSchema.safeParse(data).success;
}
