import type { ProviderSnapshot } from "./types";

function clampNonNegative(value: number): number {
  return Math.max(0, Number.isFinite(value) ? value : 0);
}

export function normalizeUsd(
  provider: ProviderSnapshot["provider"],
  usedUsd: number,
  limitUsd: number,
  capturedAt: string,
  cycleStart: string,
  cycleEnd: string,
  source: ProviderSnapshot["source"] = "api",
): ProviderSnapshot {
  const used = clampNonNegative(usedUsd);
  const limit = clampNonNegative(limitUsd);
  const utilizationPercent = limit > 0 ? (used / limit) * 100 : 0;

  return {
    provider,
    capturedAt,
    cycleStart,
    cycleEnd,
    nativeUnit: "usd",
    nativeUsed: used,
    nativeLimit: limit,
    budgetUsd: limit,
    actualUsedUsd: used,
    equivalentUsedUsd: used,
    remainingUsd: Math.max(0, limit - used),
    utilizationPercent,
    source,
  };
}

export function normalizeCredits(
  provider: ProviderSnapshot["provider"],
  usedCredits: number,
  limitCredits: number,
  budgetUsd: number,
  capturedAt: string,
  cycleStart: string,
  cycleEnd: string,
  source: ProviderSnapshot["source"] = "page",
): ProviderSnapshot {
  const used = clampNonNegative(usedCredits);
  const limit = clampNonNegative(limitCredits);
  const budget = clampNonNegative(budgetUsd);
  const utilization = limit > 0 ? used / limit : 0;
  const equivalentUsedUsd = utilization * budget;

  return {
    provider,
    capturedAt,
    cycleStart,
    cycleEnd,
    nativeUnit: "credits",
    nativeUsed: used,
    nativeLimit: limit,
    budgetUsd: budget,
    equivalentUsedUsd,
    remainingUsd: Math.max(0, budget - equivalentUsedUsd),
    utilizationPercent: utilization * 100,
    source,
  };
}

export function combineSnapshots(snapshots: ProviderSnapshot[]) {
  return snapshots.reduce(
    (total, snapshot) => ({
      usedUsd: total.usedUsd + snapshot.equivalentUsedUsd,
      limitUsd: total.limitUsd + snapshot.budgetUsd,
      remainingUsd: total.remainingUsd + snapshot.remainingUsd,
    }),
    { usedUsd: 0, limitUsd: 0, remainingUsd: 0 },
  );
}
