import { collectProvider, normalizePageResult, type CollectionResult } from "./collectors";
import { providerUsageUrl } from "./providers";
import { createInitialState, getState, recordSnapshot, resetHistory, saveSettings, saveState, updateProvider } from "./state";
import { normalizeSyncMinutes } from "./sync";
import { PROVIDER_IDS, type ExtensionMessage, type ProviderId } from "./types";

const REFRESH_ALARM = "refresh-ai-usage";
let refreshPromise: Promise<void> | undefined;

async function scheduleRefresh(minutes: number): Promise<void> {
  await chrome.alarms.clear(REFRESH_ALARM);
  await chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: normalizeSyncMinutes(minutes) });
}

async function ensureInitialized(): Promise<void> {
  const stored = await chrome.storage.local.get("aiUsageMeterState");
  if (!stored.aiUsageMeterState) await saveState(createInitialState());
  await scheduleRefresh((await getState()).settings.syncMinutes);
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

async function runRefresh(): Promise<void> {
  const attemptedAt = new Date().toISOString();
  const state = await getState();
  for (const provider of PROVIDER_IDS) {
    await updateProvider(provider, { status: "checking", lastAttemptAt: attemptedAt });
    await applyResult(provider, await collectProvider(provider, state.providers[provider].budgetUsd), attemptedAt);
  }
  const refreshed = await getState();
  refreshed.lastRefreshAt = attemptedAt;
  await saveState(refreshed);
  await updateBadge();
}

async function refreshAll(): Promise<void> {
  if (!refreshPromise) refreshPromise = runRefresh().finally(() => { refreshPromise = undefined; });
  return refreshPromise;
}

async function openSignIn(provider: ProviderId): Promise<void> {
  await chrome.tabs.create({ url: providerUsageUrl(provider), active: true });
  await updateProvider(provider, { status: "checking", message: "Usage page opened. If prompted, sign in; then return and refresh." });
}

async function acceptPageUsage(message: Extract<ExtensionMessage, { type: "PAGE_USAGE" }>): Promise<void> {
  const state = await getState();
  await applyResult(message.result.provider, normalizePageResult(message.result, state.providers[message.result.provider].budgetUsd), new Date().toISOString());
  await updateBadge();
}

chrome.runtime.onInstalled.addListener(() => { void ensureInitialized().then(refreshAll); });
chrome.runtime.onStartup.addListener(() => { void ensureInitialized().then(refreshAll); });
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === REFRESH_ALARM) void refreshAll(); });

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  void (async () => {
    if (message.type === "GET_STATE") sendResponse(await getState());
    else if (message.type === "REFRESH_ALL") { await refreshAll(); sendResponse(await getState()); }
    else if (message.type === "SAVE_SETTINGS") {
      const state = await saveSettings(message.budgets, message.retentionMonths, message.syncMinutes);
      await scheduleRefresh(state.settings.syncMinutes);
      sendResponse(state);
    }
    else if (message.type === "OPEN_SIGN_IN") { await openSignIn(message.provider); sendResponse(await getState()); }
    else if (message.type === "PAGE_USAGE") { await acceptPageUsage(message); sendResponse({ ok: true }); }
    else if (message.type === "EXPORT_DATA") sendResponse(await getState());
    else if (message.type === "RESET_HISTORY") sendResponse(await resetHistory());
  })().catch((error: unknown) => sendResponse({ error: error instanceof Error ? error.message : "Unexpected error" }));
  return true;
});

void ensureInitialized();
