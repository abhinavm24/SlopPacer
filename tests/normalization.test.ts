import { describe, expect, it } from "vitest";
import { combineSnapshots, normalizeCredits, normalizeUsd } from "../src/normalization";

const capturedAt = "2026-07-17T00:00:00.000Z";
const cycleStart = "2026-07-01";
const cycleEnd = "2026-08-01";

describe("usage normalization", () => {
  it("keeps USD usage exact", () => {
    const result = normalizeUsd("claude", 897.6, 2000, capturedAt, cycleStart, cycleEnd);
    expect(result.equivalentUsedUsd).toBe(897.6);
    expect(result.remainingUsd).toBe(1102.4);
    expect(result.utilizationPercent).toBeCloseTo(44.88);
  });

  it("converts credits to budget-equivalent USD", () => {
    const result = normalizeCredits("chatgpt", 2850, 28500, 2000, capturedAt, cycleStart, cycleEnd);
    expect(result.equivalentUsedUsd).toBe(200);
    expect(result.remainingUsd).toBe(1800);
    expect(result.actualUsedUsd).toBeUndefined();
  });

  it("combines heterogeneous provider snapshots", () => {
    const claude = normalizeUsd("claude", 900, 2000, capturedAt, cycleStart, cycleEnd);
    const chatgpt = normalizeCredits("chatgpt", 2850, 28500, 2000, capturedAt, cycleStart, cycleEnd);
    const cursor = normalizeUsd("cursor", 50, 2000, capturedAt, cycleStart, cycleEnd);
    expect(combineSnapshots([claude, chatgpt, cursor])).toEqual({
      usedUsd: 1150,
      limitUsd: 6000,
      remainingUsd: 4850,
    });
  });
});
