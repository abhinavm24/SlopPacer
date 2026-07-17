import type { ProviderId } from "./types";

export interface ProviderDefinition {
  id: ProviderId;
  name: string;
  usageUrl: string;
}

export const PROVIDERS: Record<ProviderId, ProviderDefinition> = {
  claude: {
    id: "claude",
    name: "Claude",
    usageUrl: "https://claude.ai/new#settings/usage",
  },
  chatgpt: {
    id: "chatgpt",
    name: "ChatGPT",
    usageUrl: "https://chatgpt.com/#settings/Usage",
  },
  cursor: {
    id: "cursor",
    name: "Cursor",
    usageUrl: "https://cursor.com/dashboard/usage",
  },
};

function localDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function providerUsageUrl(provider: ProviderId, now = new Date()): string {
  if (provider !== "cursor") return PROVIDERS[provider].usageUrl;
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const from = localDate(year, month, 1);
  const to = localDate(year, month, now.getDate());
  return `${PROVIDERS.cursor.usageUrl}?from=${from}&to=${to}`;
}
