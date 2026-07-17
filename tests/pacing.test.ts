import { describe, expect, it } from "vitest";
import { calculatePacing, countWorkingDays } from "../src/pacing";

describe("working-day pacing", () => {
  it("counts weekdays inclusively", () => {
    expect(countWorkingDays("2026-07-01", "2026-07-31")).toBe(23);
    expect(countWorkingDays("2026-07-18", "2026-07-19")).toBe(0);
  });

  it("includes today in elapsed and remaining working days", () => {
    const pacing = calculatePacing(1000, 2000, "2026-07-01", "2026-07-31", new Date("2026-07-17T07:00:00Z"));
    expect(pacing.elapsedWorkingDays).toBe(13);
    expect(pacing.remainingWorkingDays).toBe(11);
    expect(pacing.requiredPerRemainingDay).toBeCloseTo(90.91);
  });

  it("marks usage below the even monthly pace", () => {
    const pacing = calculatePacing(500, 2000, "2026-07-01", "2026-07-31", new Date("2026-07-17T07:00:00Z"));
    expect(pacing.averagePerElapsedDay).toBeCloseTo(38.46);
    expect(pacing.requiredPerRemainingDay).toBeCloseTo(136.36);
    expect(pacing.paceStatus).toBe("under");
  });

  it("uses a ten percent neutral band and marks overuse", () => {
    const onPace = calculatePacing(1040, 2000, "2026-07-01", "2026-07-31", new Date("2026-07-17T07:00:00Z"));
    const over = calculatePacing(1500, 2000, "2026-07-01", "2026-07-31", new Date("2026-07-17T07:00:00Z"));
    expect(onPace.paceStatus).toBe("on_pace");
    expect(over.paceStatus).toBe("over");
  });
});
