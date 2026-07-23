import type { z } from "zod";
import {
  dailyUsageSchema,
  extensionSettingsSchema,
  isRecord,
  isoDateTimeSchema,
  parseBackupValue,
  parseExtensionState,
  providerStateSchema,
} from "./backup";
import type { ImportDataResult } from "./messages";
import {
  PROVIDER_IDS,
  type DailyUsage,
  type ExtensionSettings,
  type ExtensionState,
  type ProviderId,
  type ProviderSnapshot,
  type ProviderState,
} from "./types";
import { DEFAULT_SYNC_MINUTES, normalizeSyncMinutes } from "./sync";

const STORAGE_KEY = "aiUsageMeterState";

function emptyProvider<const T extends ProviderId>(id: T): ProviderState<T> {
  return { id, status: "not_configured", budgetUsd: 2000, history: [] };
}

export function createInitialState(): ExtensionState {
  return {
    schemaVersion: 3,
    providers: {
      claude: emptyProvider("claude"),
      chatgpt: emptyProvider("chatgpt"),
      cursor: emptyProvider("cursor"),
    },
    settings: { retentionMonths: 13, syncMinutes: DEFAULT_SYNC_MINUTES, allowScheduledCursorFocus: false },
  };
}

function migrate(value: unknown): ExtensionState {
  const initial = createInitialState();
  if (!isRecord(value)) return initial;
  const providers = isRecord(value.providers) ? value.providers : {};
  const lastRefreshAt = parseWithDefault(
    isoDateTimeSchema.optional(),
    value.lastRefreshAt,
    initial.lastRefreshAt,
  );
  const migrated: ExtensionState = {
    schemaVersion: 3,
    providers: {
      claude: migrateProvider("claude", providers.claude, initial.providers.claude),
      chatgpt: migrateProvider("chatgpt", providers.chatgpt, initial.providers.chatgpt),
      cursor: migrateProvider("cursor", providers.cursor, initial.providers.cursor),
    },
    settings: migrateSettings(value.settings, initial.settings),
  };
  if (lastRefreshAt !== undefined) migrated.lastRefreshAt = lastRefreshAt;
  return parseExtensionState(migrated) ?? initial;
}

function migrateProvider<const T extends ProviderId>(
  id: T,
  value: unknown,
  fallback: ProviderState<T>,
): ProviderState<T> {
  const old = isRecord(value) ? value : {};
  const schema = providerStateSchema(id);
  const migrated: ProviderState<T> = {
    id,
    status: parseWithDefault(schema.shape.status, old.status, fallback.status),
    budgetUsd: parseWithDefault(schema.shape.budgetUsd, old.budgetUsd, fallback.budgetUsd),
    history: migrateHistory(old.history, fallback.history),
  };
  const snapshot = parseWithDefault(schema.shape.snapshot, old.snapshot, fallback.snapshot);
  const message = parseWithDefault(schema.shape.message, old.message, fallback.message);
  const lastAttemptAt = parseWithDefault(
    schema.shape.lastAttemptAt,
    old.lastAttemptAt,
    fallback.lastAttemptAt,
  );
  const lastSuccessAt = parseWithDefault(
    schema.shape.lastSuccessAt,
    old.lastSuccessAt,
    fallback.lastSuccessAt,
  );
  if (snapshot !== undefined) migrated.snapshot = snapshot;
  if (message !== undefined) migrated.message = message;
  if (lastAttemptAt !== undefined) migrated.lastAttemptAt = lastAttemptAt;
  if (lastSuccessAt !== undefined) migrated.lastSuccessAt = lastSuccessAt;
  return migrated;
}

function migrateHistory(value: unknown, fallback: DailyUsage[]): DailyUsage[] {
  if (!Array.isArray(value)) return fallback;
  return value.flatMap((entry) => {
    const parsed = dailyUsageSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

function migrateSettings(value: unknown, fallback: ExtensionSettings): ExtensionSettings {
  const old = isRecord(value) ? value : {};
  return {
    retentionMonths: parseWithDefault(
      extensionSettingsSchema.shape.retentionMonths,
      old.retentionMonths,
      fallback.retentionMonths,
    ),
    syncMinutes: parseWithDefault(
      extensionSettingsSchema.shape.syncMinutes,
      old.syncMinutes,
      fallback.syncMinutes,
    ),
    allowScheduledCursorFocus: parseWithDefault(
      extensionSettingsSchema.shape.allowScheduledCursorFocus,
      old.allowScheduledCursorFocus,
      fallback.allowScheduledCursorFocus,
    ),
  };
}

function parseWithDefault<T>(
  schema: z.ZodType<T>,
  value: unknown,
  fallback: T,
): T {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

export async function getState(): Promise<ExtensionState> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return migrate(stored[STORAGE_KEY]);
}

export async function saveState(state: ExtensionState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

export async function restoreBackup(value: unknown): Promise<ImportDataResult> {
  const parsed = parseBackupValue(value);
  if (!parsed.ok) return parsed;
  const { state, exportedAt } = parsed.backup;
  await saveState(state);
  return {
    ok: true,
    state,
    exportedAt,
  };
}

export async function updateProvider<const T extends ProviderId>(
  provider: T,
  patch: Partial<ProviderState<T>>,
): Promise<ExtensionState> {
  const state = await getState();
  state.providers[provider] = { ...state.providers[provider], ...patch };
  await saveState(state);
  return state;
}

function cutoffDate(months: number): string {
  const cutoff = new Date();
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  return cutoff.toISOString().slice(0, 10);
}

function enumerateDates(start: string, end: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  while (cursor <= last) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export async function recordSnapshot(snapshot: ProviderSnapshot): Promise<ExtensionState> {
  const state = await getState();
  const provider = state.providers[snapshot.provider];
  const date = snapshot.capturedAt.slice(0, 10);
  const previous = provider.snapshot;
  const sameCycle = previous?.cycleStart === snapshot.cycleStart;
  const hasCycleHistory = provider.history.some(
    (item) => item.date >= snapshot.cycleStart && item.date <= date,
  );
  const spreadDates = enumerateDates(snapshot.cycleStart, date);

  let history: DailyUsage[];
  if (!sameCycle && !hasCycleHistory && spreadDates.length > 1 && snapshot.equivalentUsedUsd > 0) {
    // First reading for this cycle with no recorded days yet: spread the captured
    // month-to-date evenly across every elapsed day instead of dumping the whole
    // month's spend onto the capture day. Later same-cycle captures fall through to
    // the delta path below and attribute only the incremental spend to that day.
    const divisor = spreadDates.length;
    const spread: DailyUsage[] = spreadDates.map((spreadDate) => ({
      date: spreadDate,
      equivalentUsedUsd: snapshot.equivalentUsedUsd / divisor,
      actualUsedUsd: snapshot.actualUsedUsd === undefined ? undefined : snapshot.actualUsedUsd / divisor,
      nativeUsed: snapshot.nativeUsed / divisor,
    }));
    history = [...provider.history, ...spread];
  } else {
    const priorEquivalent = sameCycle ? previous.equivalentUsedUsd : 0;
    const priorActual = sameCycle ? previous.actualUsedUsd : undefined;
    const priorNative = sameCycle ? previous.nativeUsed : 0;
    const delta: DailyUsage = {
      date,
      equivalentUsedUsd: snapshot.equivalentUsedUsd - priorEquivalent,
      actualUsedUsd: snapshot.actualUsedUsd === undefined ? undefined : snapshot.actualUsedUsd - (priorActual ?? 0),
      nativeUsed: snapshot.nativeUsed - priorNative,
    };
    const existing = provider.history.find((item) => item.date === date);
    history = [
      ...provider.history.filter((item) => item.date !== date),
      {
        date,
        equivalentUsedUsd: (existing?.equivalentUsedUsd ?? 0) + delta.equivalentUsedUsd,
        actualUsedUsd: delta.actualUsedUsd === undefined ? existing?.actualUsedUsd : (existing?.actualUsedUsd ?? 0) + delta.actualUsedUsd,
        nativeUsed: (existing?.nativeUsed ?? 0) + (delta.nativeUsed ?? 0),
      },
    ];
  }

  const cutoff = cutoffDate(state.settings.retentionMonths);
  provider.history = history.filter((item) => item.date >= cutoff).sort((a, b) => a.date.localeCompare(b.date));
  provider.snapshot = snapshot;
  provider.status = "connected";
  provider.message = snapshot.source === "page" ? "Connected via usage page" : "Connected";
  provider.lastAttemptAt = snapshot.capturedAt;
  provider.lastSuccessAt = snapshot.capturedAt;
  await saveState(state);
  return state;
}

export async function saveSettings(
  budgets: Record<ProviderId, number>,
  retentionMonths: number,
  syncMinutes: number,
  allowScheduledCursorFocus: boolean,
): Promise<ExtensionState> {
  const state = await getState();
  for (const provider of PROVIDER_IDS) state.providers[provider].budgetUsd = Math.max(0, budgets[provider]);
  state.settings.retentionMonths = Math.min(24, Math.max(1, Math.round(retentionMonths)));
  state.settings.syncMinutes = normalizeSyncMinutes(syncMinutes);
  state.settings.allowScheduledCursorFocus = allowScheduledCursorFocus;
  await saveState(state);
  return state;
}

export async function resetHistory(): Promise<ExtensionState> {
  const state = await getState();
  for (const provider of PROVIDER_IDS) state.providers[provider].history = [];
  await saveState(state);
  return state;
}
