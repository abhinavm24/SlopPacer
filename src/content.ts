import { parseUsagePage } from "./page-parser";
import type { ContentMessage, ProviderId } from "./types";

function providerForHost(host: string): ProviderId | undefined {
  if (host === "claude.ai") return "claude";
  if (host === "chatgpt.com") return "chatgpt";
  if (host === "cursor.com") return "cursor";
  return undefined;
}

function scrape() {
  const provider = providerForHost(location.hostname);
  return provider ? parseUsagePage(provider, document.body?.innerText ?? "", location.href) : undefined;
}

chrome.runtime.onMessage.addListener((message: ContentMessage, _sender, sendResponse) => {
  if (message.type === "SCRAPE_USAGE") sendResponse(scrape());
});

let lastResult = "";
function publish(): void {
  const result = scrape();
  if (!result || result.kind === "unavailable") return;
  const serialized = JSON.stringify(result);
  if (serialized === lastResult) return;
  lastResult = serialized;
  void chrome.runtime.sendMessage({ type: "PAGE_USAGE", result });
}

setTimeout(publish, 1500);
setTimeout(publish, 5000);
new MutationObserver(() => {
  clearTimeout(Number(document.documentElement.dataset.aiUsageTimer));
  const timer = window.setTimeout(publish, 800);
  document.documentElement.dataset.aiUsageTimer = String(timer);
}).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
