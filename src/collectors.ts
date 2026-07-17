import { normalizeCredits, normalizeUsd } from "./normalization";
import { PROVIDERS, providerUsageUrl } from "./providers";
import type { PageUsageResult, ProviderId, ProviderSnapshot } from "./types";

export type CollectionResult =
  | { kind: "success"; snapshot: ProviderSnapshot }
  | { kind: "auth_required"; message: string }
  | { kind: "page_required" | "retryable_error" | "error"; message: string };

const TEMPORARY_PAGE_TIMEOUT_MS: Record<ProviderId, number> = {
  claude: 30_000,
  chatgpt: 30_000,
  cursor: 90_000,
};
const TEMPORARY_PAGE_POLL_MS = 500;

function cycle(now = new Date()): { start: string; end: string } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return {
    start: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10),
    end: new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10),
  };
}

function pageSnapshot(result: PageUsageResult, budgetUsd: number): CollectionResult {
  if (result.kind === "auth_required") return { kind: "auth_required", message: result.message ?? "Sign in required." };
  if (result.kind !== "usage" || result.used === undefined || result.limit === undefined || !result.nativeUnit) {
    return { kind: "error", message: result.message ?? "Usage values were not found on the page." };
  }
  const now = new Date().toISOString();
  const current = cycle();
  const snapshot = result.nativeUnit === "credits"
    ? normalizeCredits(result.provider, result.used, result.limit, budgetUsd, now, current.start, current.end, "page")
    : normalizeUsd(result.provider, result.used, result.limit || budgetUsd, now, current.start, current.end, "page");
  return { kind: "success", snapshot };
}

async function fromOpenPage(provider: ProviderId, budgetUsd: number): Promise<CollectionResult | undefined> {
  const origin = new URL(PROVIDERS[provider].usageUrl).origin;
  const tabs = await chrome.tabs.query({ url: `${origin}/*` });
  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      const result = await chrome.tabs.sendMessage(tab.id, { type: "SCRAPE_USAGE" }) as PageUsageResult | undefined;
      if (result && result.kind !== "unavailable") return pageSnapshot(result, budgetUsd);
    } catch {
      // Older tabs may predate installation; a temporary page can still be used.
    }
  }
  return undefined;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fromTemporaryPage(
  provider: ProviderId,
  budgetUsd: number,
  allowVisiblePage: boolean,
): Promise<CollectionResult | undefined> {
  // Cursor does not request its usage data while its dashboard is hidden.
  // Keep the other provider tabs inactive, but briefly foreground Cursor so its
  // visibility-gated request runs, then return the user to their previous tab.
  const needsVisiblePage = provider === "cursor" && allowVisiblePage;
  const [previousTab] = needsVisiblePage ? await chrome.tabs.query({ active: true, currentWindow: true }) : [];
  const tab = await chrome.tabs.create({ url: providerUsageUrl(provider), active: needsVisiblePage });
  if (!tab.id) return undefined;
  const deadline = Date.now() + TEMPORARY_PAGE_TIMEOUT_MS[provider];
  try {
    while (Date.now() < deadline) {
      try {
        const result = await chrome.tabs.sendMessage(tab.id, { type: "SCRAPE_USAGE" }) as PageUsageResult | undefined;
        if (result && result.kind !== "unavailable") return pageSnapshot(result, budgetUsd);
      } catch {
        // The content script is not ready while the temporary page is loading.
      }
      await wait(TEMPORARY_PAGE_POLL_MS);
    }
    return undefined;
  } finally {
    try {
      await chrome.tabs.remove(tab.id);
    } catch {
      // The user may have closed the temporary tab first.
    }
    if (needsVisiblePage && previousTab?.id) {
      try {
        await chrome.tabs.update(previousTab.id, { active: true });
      } catch {
        // The previous tab or its window may have been closed during refresh.
      }
    }
  }
}

export async function collectProvider(
  provider: ProviderId,
  budgetUsd: number,
  allowVisiblePage = false,
): Promise<CollectionResult> {
  return (await fromOpenPage(provider, budgetUsd)) ?? (await fromTemporaryPage(provider, budgetUsd, allowVisiblePage)) ?? {
    kind: "page_required",
    message: `Open ${PROVIDERS[provider].name} Usage to update its current total.`,
  };
}

export function normalizePageResult(result: PageUsageResult, budgetUsd: number): CollectionResult {
  return pageSnapshot(result, budgetUsd);
}
