import type { PageUsageResult, ProviderId } from "./types";

const number = String.raw`([\d,.]+)`;

function amount(value: string): number {
  return Number(value.replaceAll(",", ""));
}

function matchPair(text: string, patterns: RegExp[]): [number, number] | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1] && match[2]) return [amount(match[1]), amount(match[2])];
  }
  return undefined;
}

export function parseUsagePage(provider: ProviderId, text: string, url: string): PageUsageResult {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (/log in|sign in|continue with google|continue with sso/i.test(normalized) || /login|auth/i.test(new URL(url).pathname)) {
    return { provider, kind: "auth_required", message: "Your session has expired. Sign in to reconnect." };
  }

  if (provider === "chatgpt") {
    const pair = matchPair(normalized, [
      new RegExp(String.raw`${number}\s*(?:used\s*)?(?:\/|of)\s*${number}\s*credits?`, "i"),
      new RegExp(String.raw`credits?[^\d]*${number}\s*(?:\/|of)\s*${number}`, "i"),
    ]);
    if (pair) return { provider, kind: "usage", used: pair[0], limit: pair[1], nativeUnit: "credits" };
  } else {
    const pair = matchPair(normalized, [
      new RegExp(String.raw`\$${number}\s*(?:spent|used)?\s*(?:\/|of)\s*\$${number}`, "i"),
      new RegExp(String.raw`\$${number}\s*(?:\/|of)\s*\$${number}\s*(?:spent|used)?`, "i"),
      new RegExp(String.raw`(?:spend|usage)[^$]{0,40}\$${number}[^$]{0,40}\$${number}`, "i"),
    ]);
    if (pair) return { provider, kind: "usage", used: pair[0], limit: pair[1], nativeUnit: "usd" };
  }

  return { provider, kind: "unavailable", message: "Open the provider Usage page and wait for it to finish loading." };
}
