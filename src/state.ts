import { parseBackupValue, type ImportDataResult } from "./backup";
import {
  PROVIDER_IDS,
  type DailyUsage,
  type ExtensionState,
  type ProviderId,
  type ProviderSnapshot,
  type ProviderState,
} from "./types";
import { DEFAULT_SYNC_MINUTES, normalizeSyncMinutes } from "./sync";

const STORAGE_KEY = "aiUsageMeterState";

function emptyProvider(id: ProviderId): ProviderState {
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
  if (!value || typeof value !== "object") return initial;
  const old = value as Partial<ExtensionState> & { providers?: Partial<Record<ProviderId, Partial<ProviderState>>> };
  for (const id of PROVIDER_IDS) {
    initial.providers[id] = { ...initial.providers[id], ...old.providers?.[id], id, history: old.providers?.[id]?.history ?? [] };
  }
  initial.lastRefreshAt = old.lastRefreshAt;
  initial.settings = { ...initial.settings, ...old.settings };
  return initial;
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
  await saveState(parsed.backup.state);
  return {
    ok: true,
    state: parsed.backup.state,
    exportedAt: parsed.backup.exportedAt,
  };
}

export async function updateProvider(provider: ProviderId, patch: Partial<ProviderState>): Promise<ExtensionState> {
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

export async function recordSnapshot(snapshot: ProviderSnapshot): Promise<ExtensionState> {
  const state = await getState();
  const provider = state.providers[snapshot.provider];
  const date = snapshot.capturedAt.slice(0, 10);
  const previous = provider.snapshot;
  const sameCycle = previous?.cycleStart === snapshot.cycleStart;
  const priorEquivalent = sameCycle ? previous.equivalentUsedUsd : 0;
  const priorActual = sameCycle ? previous.actualUsedUsd : undefined;
  const priorNative = sameCycle ? previous.nativeUsed : 0;
  const delta: DailyUsage = {
    date,
    equivalentUsedUsd: snapshot.equivalentUsedUsd - priorEquivalent,
    actualUsedUsd: snapshot.actualUsedUsd === undefined ? undefined : snapshot.actualUsedUsd - (priorActual ?? 0),
    nativeUsed: snapshot.nativeUsed - priorNative,
  };
  const history = provider.history.filter((item) => item.date !== date);
  const existing = provider.history.find((item) => item.date === date);
  history.push({
    date,
    equivalentUsedUsd: (existing?.equivalentUsedUsd ?? 0) + delta.equivalentUsedUsd,
    actualUsedUsd: delta.actualUsedUsd === undefined ? existing?.actualUsedUsd : (existing?.actualUsedUsd ?? 0) + delta.actualUsedUsd,
    nativeUsed: (existing?.nativeUsed ?? 0) + (delta.nativeUsed ?? 0),
  });
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
