import { createBackup, type ImportDataResult } from "./backup";
import { collectProvider, normalizePageResult, type CollectionResult } from "./collectors";
import { providerUsageUrl } from "./providers";
import { SerialTaskQueue } from "./serial-queue";
import {
  createInitialState,
  getState,
  recordSnapshot,
  resetHistory,
  restoreBackup,
  saveSettings,
  saveState,
  updateProvider,
} from "./state";
import { normalizeSyncMinutes } from "./sync";
import { PROVIDER_IDS, type ExtensionMessage, type ProviderId } from "./types";

const REFRESH_ALARM = "refresh-ai-usage";
const stateTasks = new SerialTaskQueue();
let refreshPromise: Promise<void> | undefined;
let refreshAllowsVisibleCursor = false;

async function scheduleRefresh(minutes: number): Promise<void> {
  await chrome.alarms.clear(REFRESH_ALARM);
  await chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: normalizeSyncMinutes(minutes) });
}

async function ensureInitialized(): Promise<void> {
  await stateTasks.run(async () => {
    const stored = await chrome.storage.local.get("aiUsageMeterState");
    if (!stored.aiUsageMeterState) await saveState(createInitialState());
    await scheduleRefresh((await getState()).settings.syncMinutes);
  });
}

async function applyResult(provider: ProviderId, result: CollectionResult, attemptedAt: string): Promise<void> {
  if (result.kind === "success") {
    await recordSnapshot(result.snapshot);
    return;
  }
  const current = (await getState()).providers[provider];
  await updateProvider(provider, {
    status: result.kind === "page_required" && current.snapshot ? "connected" : result.kind,
    message: result.kind === "page_required" && current.snapshot ? `${result.message} Last successful value is retained.` : result.message,
    lastAttemptAt: attemptedAt,
  });
}

async function updateBadge(): Promise<void> {
  const state = await getState();
  const needsAuth = PROVIDER_IDS.some((id) => state.providers[id].status === "auth_required");
  await chrome.action.setBadgeBackgroundColor({ color: "#b45309" });
  await chrome.action.setBadgeText({ text: needsAuth ? "!" : "" });
}

async function runRefresh(allowVisibleCursor: boolean): Promise<void> {
  const attemptedAt = new Date().toISOString();
  const state = await getState();
  for (const provider of PROVIDER_IDS) {
    await updateProvider(provider, { status: "checking", lastAttemptAt: attemptedAt });
  }
  const results = await Promise.all(PROVIDER_IDS.map(async (provider) => ({
    provider,
    result: await collectProvider(provider, state.providers[provider].budgetUsd, allowVisibleCursor),
  })));
  // State helpers use read-modify-write, so apply results serially after the slow
  // page reads finish in parallel. This prevents one provider from clobbering another.
  for (const { provider, result } of results) await applyResult(provider, result, attemptedAt);
  const refreshed = await getState();
  refreshed.lastRefreshAt = attemptedAt;
  await saveState(refreshed);
  await updateBadge();
}

async function refreshAll(allowVisibleCursor = false): Promise<void> {
  const activeRefresh = refreshPromise;
  if (activeRefresh && allowVisibleCursor && !refreshAllowsVisibleCursor) {
    await activeRefresh.catch(() => undefined);
    return refreshAll(true);
  }
  if (activeRefresh) return activeRefresh;
  refreshAllowsVisibleCursor = allowVisibleCursor;
  const queuedRefresh = stateTasks.run(() => runRefresh(allowVisibleCursor));
  const trackedRefresh = queuedRefresh.finally(() => {
    if (refreshPromise === trackedRefresh) {
      refreshPromise = undefined;
      refreshAllowsVisibleCursor = false;
    }
  });
  refreshPromise = trackedRefresh;
  return trackedRefresh;
}

async function refreshScheduled(): Promise<void> {
  const state = await stateTasks.run(getState);
  await refreshAll(state.settings.allowScheduledCursorFocus);
}

async function importData(backup: unknown): Promise<ImportDataResult> {
  return stateTasks.run(async () => {
    const result = await restoreBackup(backup);
    if (result.ok) {
      await Promise.allSettled([
        scheduleRefresh(result.state.settings.syncMinutes),
        updateBadge(),
      ]);
    }
    return result;
  });
}

async function openSignIn(provider: ProviderId) {
  await chrome.tabs.create({ url: providerUsageUrl(provider), active: true });
  return stateTasks.run(() => updateProvider(provider, {
    status: "checking",
    message: "Usage page opened. If prompted, sign in; then return and refresh.",
  }));
}

async function acceptPageUsage(message: Extract<ExtensionMessage, { type: "PAGE_USAGE" }>): Promise<void> {
  const state = await getState();
  await applyResult(message.result.provider, normalizePageResult(message.result, state.providers[message.result.provider].budgetUsd), new Date().toISOString());
  await updateBadge();
}

chrome.runtime.onInstalled.addListener(() => { void ensureInitialized().then(refreshScheduled); });
chrome.runtime.onStartup.addListener(() => { void ensureInitialized().then(refreshScheduled); });
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === REFRESH_ALARM) void refreshScheduled(); });

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  void (async () => {
    if (message.type === "GET_STATE") sendResponse(await stateTasks.run(getState));
    else if (message.type === "REFRESH_ALL") { await refreshAll(true); sendResponse(await stateTasks.run(getState)); }
    else if (message.type === "SAVE_SETTINGS") {
      const state = await stateTasks.run(async () => {
        const saved = await saveSettings(
          message.budgets,
          message.retentionMonths,
          message.syncMinutes,
          message.allowScheduledCursorFocus,
        );
        await scheduleRefresh(saved.settings.syncMinutes);
        return saved;
      });
      sendResponse(state);
    }
    else if (message.type === "OPEN_SIGN_IN") sendResponse(await openSignIn(message.provider));
    else if (message.type === "PAGE_USAGE") {
      await stateTasks.run(() => acceptPageUsage(message));
      sendResponse({ ok: true });
    }
    else if (message.type === "EXPORT_DATA") sendResponse(createBackup(await stateTasks.run(getState)));
    else if (message.type === "IMPORT_DATA") sendResponse(await importData(message.backup));
    else if (message.type === "RESET_HISTORY") sendResponse(await stateTasks.run(resetHistory));
  })().catch((error: unknown) => {
    if (message.type === "IMPORT_DATA") {
      const result: ImportDataResult = { ok: false, error: "import_failed" };
      sendResponse(result);
      return;
    }
    sendResponse({ error: error instanceof Error ? error.message : "Unexpected error" });
  });
  return true;
});

void ensureInitialized();
