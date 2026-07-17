export interface PacingMetrics {
  totalWorkingDays: number;
  elapsedWorkingDays: number;
  remainingWorkingDays: number;
  averagePerElapsedDay: number;
  targetPerWorkingDay: number;
  requiredPerRemainingDay: number;
  remainingPercent: number;
  paceStatus: "under" | "on_pace" | "over";
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
  const safeUsed = Math.max(0, used);
  const safeBudget = Math.max(0, budget);
  const remaining = Math.max(0, safeBudget - safeUsed);
  const targetPerWorkingDay = totalWorkingDays ? safeBudget / totalWorkingDays : 0;
  const averagePerElapsedDay = elapsedWorkingDays ? safeUsed / elapsedWorkingDays : 0;
  const requiredPerRemainingDay = remainingWorkingDays ? remaining / remainingWorkingDays : remaining;
  const paceRatio = requiredPerRemainingDay > 0 ? averagePerElapsedDay / requiredPerRemainingDay : averagePerElapsedDay > 0 ? Infinity : 1;

  return {
    totalWorkingDays,
    elapsedWorkingDays,
    remainingWorkingDays,
    averagePerElapsedDay,
    targetPerWorkingDay,
    requiredPerRemainingDay,
    remainingPercent: safeBudget ? (remaining / safeBudget) * 100 : 0,
    paceStatus: elapsedWorkingDays === 0 || (paceRatio >= 0.9 && paceRatio <= 1.1)
      ? "on_pace"
      : paceRatio < 0.9 ? "under" : "over",
  };
}
