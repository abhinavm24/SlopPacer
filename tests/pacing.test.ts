import { describe, expect, it } from "vitest";
import { calculatePacing, countCalendarDays, countWorkingDays } from "../src/pacing";

describe("working-day pacing", () => {
  it("counts weekdays inclusively", () => {
    expect(countWorkingDays("2026-07-01", "2026-07-31")).toBe(23);
    expect(countWorkingDays("2026-07-18", "2026-07-19")).toBe(0);
  });

  it("counts calendar days inclusively", () => {
    expect(countCalendarDays("2026-07-17", "2026-07-31")).toBe(15);
    expect(countCalendarDays("2026-07-31", "2026-07-01")).toBe(0);
  });

  it("includes today in elapsed and remaining working days", () => {
    const pacing = calculatePacing(1000, 2000, "2026-07-01", "2026-07-31", new Date("2026-07-17T07:00:00Z"));
    expect(pacing.elapsedWorkingDays).toBe(13);
    expect(pacing.remainingWorkingDays).toBe(11);
    expect(pacing.requiredPerRemainingDay).toBeCloseTo(90.91);
  });

  it("spreads the remaining budget over remaining calendar days", () => {
    const pacing = calculatePacing(1000, 2000, "2026-07-01", "2026-07-31", new Date("2026-07-17T07:00:00Z"));
    expect(pacing.requiredPerRemainingDayAllDays).toBeCloseTo(66.67);
  });

  it("derives per-day averages and available spend", () => {
    const pacing = calculatePacing(500, 2000, "2026-07-01", "2026-07-31", new Date("2026-07-17T07:00:00Z"));
    expect(pacing.averagePerElapsedDay).toBeCloseTo(38.46);
    expect(pacing.requiredPerRemainingDay).toBeCloseTo(136.36);
  });
});
