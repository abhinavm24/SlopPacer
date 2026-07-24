import { calculatePacing, countWorkingDays } from "./pacing";
import type { DailyUsage } from "./types";

export type FillStatus = "green" | "amber" | "red";

export interface SummaryBreakdown {
  todaySpent: number;
  weekSpent: number;
  monthSpent: number;
  todayAllowance: number;
  todayAllowanceAllDays: number;
  weekTarget: number;
  monthBudget: number;
  projectedMonth: number;
  left: number;
  remainingWorkingDays: number;
  remainingWorkingPercent: number;
}

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function isoWorkweek(now: Date): { start: string; end: string } {
  const day = now.getUTCDay(); // 0 Sun .. 6 Sat
  const offsetToMonday = day === 0 ? -6 : 1 - day; // Sunday belongs to the preceding work week
  const monday = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + offsetToMonday,
    12,
  ));
  const friday = new Date(monday.getTime());
  friday.setUTCDate(monday.getUTCDate() + 4);
  return { start: dateKey(monday), end: dateKey(friday) };
}

export function sumForDate(history: DailyUsage[], date: string): number {
  return history.reduce(
    (sum, item) => (item.date === date ? sum + item.equivalentUsedUsd : sum),
    0,
  );
}

export function sumRange(history: DailyUsage[], start: string, end: string): number {
  if (start > end) return 0;
  return history.reduce(
    (sum, item) => (item.date >= start && item.date <= end ? sum + item.equivalentUsedUsd : sum),
    0,
  );
}

export function fillStatus(spent: number, target: number): FillStatus {
  if (target <= 0) return "red";
  const ratio = spent / target;
  if (ratio < 0.8) return "green";
  if (ratio < 1) return "amber";
  return "red";
}

export function computeSummary(
  histories: DailyUsage[][],
  monthSpent: number,
  combinedBudget: number,
  cycleStart: string,
  cycleEnd: string,
  now = new Date(),
): SummaryBreakdown {
  const pacing = calculatePacing(monthSpent, combinedBudget, cycleStart, cycleEnd, now);
  const today = dateKey(now);
  const week = isoWorkweek(now);
  const weekStart = week.start < cycleStart ? cycleStart : week.start;
  const weekEnd = week.end > cycleEnd ? cycleEnd : week.end;
  const weekdaysInRange = countWorkingDays(weekStart, weekEnd);

  const todaySpent = histories.reduce((sum, history) => sum + sumForDate(history, today), 0);
  const weekSpent = histories.reduce((sum, history) => sum + sumRange(history, weekStart, weekEnd), 0);

  return {
    todaySpent,
    weekSpent,
    monthSpent,
    todayAllowance: pacing.requiredPerRemainingDay,
    todayAllowanceAllDays: pacing.requiredPerRemainingDayAllDays,
    weekTarget: pacing.targetPerWorkingDay * weekdaysInRange,
    monthBudget: combinedBudget,
    projectedMonth: pacing.averagePerElapsedDay * pacing.totalWorkingDays,
    left: Math.max(0, combinedBudget - monthSpent),
    remainingWorkingDays: pacing.remainingWorkingDays,
    remainingWorkingPercent:
      pacing.totalWorkingDays <= 0
        ? 0
        : (pacing.remainingWorkingDays / pacing.totalWorkingDays) * 100,
  };
}
