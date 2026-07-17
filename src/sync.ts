export const DEFAULT_SYNC_MINUTES = 15;
export const MIN_SYNC_MINUTES = 1;
export const MAX_SYNC_MINUTES = 1440;

export function normalizeSyncMinutes(value: unknown): number {
  const minutes = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(minutes)) return DEFAULT_SYNC_MINUTES;
  return Math.min(MAX_SYNC_MINUTES, Math.max(MIN_SYNC_MINUTES, Math.round(minutes)));
}
