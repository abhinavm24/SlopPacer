export interface PacingMetrics {
  totalWorkingDays: number;
  elapsedWorkingDays: number;
  remainingWorkingDays: number;
  averagePerElapsedDay: number;
  targetPerWorkingDay: number;
  requiredPerRemainingDay: number;
  requiredPerRemainingDayAllDays: number;
  remainingPercent: number;
}

function parseDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T12:00:00Z`);
}

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function countWorkingDays(start: string, end: string): number {
  const cursor = parseDate(start);
  const last = parseDate(end);
  let count = 0;
  while (cursor <= last) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

export function countCalendarDays(start: string, end: string): number {
  const first = parseDate(start);
  const last = parseDate(end);
  if (first > last) return 0;
  return Math.round((last.getTime() - first.getTime()) / 86_400_000) + 1;
}

export function calculatePacing(
  used: number,
  budget: number,
  cycleStart: string,
  cycleEnd: string,
  now = new Date(),
): PacingMetrics {
  const today = dateKey(now);
  const elapsedEnd = today < cycleStart ? cycleStart : today > cycleEnd ? cycleEnd : today;
  const remainingStart = today < cycleStart ? cycleStart : today;
  const totalWorkingDays = countWorkingDays(cycleStart, cycleEnd);
  const elapsedWorkingDays = today < cycleStart ? 0 : countWorkingDays(cycleStart, elapsedEnd);
  const remainingWorkingDays = today > cycleEnd ? 0 : countWorkingDays(remainingStart, cycleEnd);
  const remainingCalendarDays = today > cycleEnd ? 0 : countCalendarDays(remainingStart, cycleEnd);
  const safeUsed = Math.max(0, used);
  const safeBudget = Math.max(0, budget);
  const remaining = Math.max(0, safeBudget - safeUsed);
  const targetPerWorkingDay = totalWorkingDays ? safeBudget / totalWorkingDays : 0;
  const averagePerElapsedDay = elapsedWorkingDays ? safeUsed / elapsedWorkingDays : 0;
  const requiredPerRemainingDay = remainingWorkingDays ? remaining / remainingWorkingDays : remaining;
  const requiredPerRemainingDayAllDays = remainingCalendarDays ? remaining / remainingCalendarDays : remaining;

  return {
    totalWorkingDays,
    elapsedWorkingDays,
    remainingWorkingDays,
    averagePerElapsedDay,
    targetPerWorkingDay,
    requiredPerRemainingDay,
    requiredPerRemainingDayAllDays,
    remainingPercent: safeBudget ? (remaining / safeBudget) * 100 : 0,
  };
}
