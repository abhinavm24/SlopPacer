import { describe, expect, it } from "vitest";
import { computeSummary, fillStatus, isoWorkweek, sumForDate, sumRange } from "../src/periods";
import type { DailyUsage } from "../src/types";

const claude: DailyUsage[] = [
  { date: "2026-07-13", equivalentUsedUsd: 10 }, // Mon
  { date: "2026-07-16", equivalentUsedUsd: 20 }, // Thu
  { date: "2026-07-17", equivalentUsedUsd: 30 }, // Fri (today)
  { date: "2026-07-18", equivalentUsedUsd: 5 },  // Sat (outside the workweek)
];
const chatgpt: DailyUsage[] = [{ date: "2026-07-17", equivalentUsedUsd: 7 }];
const now = new Date("2026-07-17T07:00:00Z"); // Friday

describe("period helpers", () => {
  it("returns Monday..Friday of the current ISO week", () => {
    expect(isoWorkweek(now)).toEqual({ start: "2026-07-13", end: "2026-07-17" });
  });

  it("maps Saturday and Sunday back to the same work week", () => {
    expect(isoWorkweek(new Date("2026-07-18T07:00:00Z")).start).toBe("2026-07-13");
    expect(isoWorkweek(new Date("2026-07-19T07:00:00Z")).start).toBe("2026-07-13");
  });

  it("sums a single day and an inclusive range", () => {
    expect(sumForDate(claude, "2026-07-17")).toBe(30);
    expect(sumRange(claude, "2026-07-13", "2026-07-17")).toBe(60);
    expect(sumRange(claude, "2026-07-20", "2026-07-13")).toBe(0);
  });

  it("colors by fill ratio with 80% and 100% thresholds", () => {
    expect(fillStatus(79, 100)).toBe("green");
    expect(fillStatus(80, 100)).toBe("amber");
    expect(fillStatus(99, 100)).toBe("amber");
    expect(fillStatus(100, 100)).toBe("red");
    expect(fillStatus(10, 0)).toBe("red");
  });
});

describe("computeSummary", () => {
  it("breaks combined spend into today, week, and month", () => {
    const summary = computeSummary([claude, chatgpt], 1000, 2000, "2026-07-01", "2026-07-31", now);
    expect(summary.todaySpent).toBe(37);   // 30 + 7
    expect(summary.weekSpent).toBe(67);    // Mon..Fri 10+20+30 + 7; Sat 5 excluded
    expect(summary.monthSpent).toBe(1000);
    expect(summary.monthBudget).toBe(2000);
    expect(summary.left).toBe(1000);
    expect(summary.remainingWorkingDays).toBe(11);
  });

  it("uses workday allowance for today and a pace-based weekly target", () => {
    const summary = computeSummary([claude, chatgpt], 1000, 2000, "2026-07-01", "2026-07-31", now);
    expect(summary.todayAllowance).toBeCloseTo(90.91);        // 1000 / 11 workdays
    expect(summary.todayAllowanceAllDays).toBeCloseTo(66.67); // 1000 / 15 calendar days
    expect(summary.weekTarget).toBeCloseTo((2000 / 23) * 5);  // targetPerWorkingDay * 5 workdays
  });

  it("projects month-end on a workday pace", () => {
    const summary = computeSummary([claude, chatgpt], 1000, 2000, "2026-07-01", "2026-07-31", now);
    expect(summary.projectedMonth).toBeCloseTo((1000 / 13) * 23);
  });

  it("clamps the week to the start of the cycle at a month boundary", () => {
    const history: DailyUsage[] = [
      { date: "2026-07-13", equivalentUsedUsd: 100 }, // before cycleStart
      { date: "2026-07-15", equivalentUsedUsd: 40 },  // Wed, in cycle
      { date: "2026-07-17", equivalentUsedUsd: 25 },  // Fri, in cycle
    ];
    const summary = computeSummary([history], 65, 1000, "2026-07-15", "2026-07-31", now);
    expect(summary.weekSpent).toBe(65); // excludes the 100 before cycleStart
  });
});
