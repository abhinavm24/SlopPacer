export const PROVIDER_IDS = ["claude", "chatgpt", "cursor"] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export type ConnectionStatus =
  | "not_configured"
  | "checking"
  | "connected"
  | "page_required"
  | "auth_required"
  | "retryable_error"
  | "error";

export interface DailyUsage {
  date: string;
  equivalentUsedUsd: number;
  actualUsedUsd?: number;
  nativeUsed?: number;
}

export interface ProviderSnapshot {
  provider: ProviderId;
  capturedAt: string;
  cycleStart: string;
  cycleEnd: string;
  nativeUnit: "usd" | "credits";
  nativeUsed: number;
  nativeLimit: number;
  budgetUsd: number;
  actualUsedUsd?: number;
  equivalentUsedUsd: number;
  remainingUsd: number;
  utilizationPercent: number;
  source: "api" | "page";
  pendingUsd?: number;
}

export interface ProviderState {
  id: ProviderId;
  status: ConnectionStatus;
  budgetUsd: number;
  snapshot?: ProviderSnapshot;
  history: DailyUsage[];
  message?: string;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
}

export interface ExtensionSettings {
  retentionMonths: number;
  syncMinutes: number;
  allowScheduledCursorFocus: boolean;
}

export interface ExtensionState {
  schemaVersion: 3;
  providers: Record<ProviderId, ProviderState>;
  settings: ExtensionSettings;
  lastRefreshAt?: string;
}

export interface PageUsageResult {
  provider: ProviderId;
  kind: "usage" | "auth_required" | "unavailable";
  used?: number;
  limit?: number;
  nativeUnit?: "usd" | "credits";
  message?: string;
}

export type ExtensionMessage =
  | { type: "GET_STATE" }
  | { type: "REFRESH_ALL" }
  | {
    type: "SAVE_SETTINGS";
    budgets: Record<ProviderId, number>;
    retentionMonths: number;
    syncMinutes: number;
    allowScheduledCursorFocus: boolean;
  }
  | { type: "OPEN_SIGN_IN"; provider: ProviderId }
  | { type: "PAGE_USAGE"; result: PageUsageResult }
  | { type: "EXPORT_DATA" }
  | { type: "IMPORT_DATA"; backup: unknown }
  | { type: "RESET_HISTORY" };

export type ContentMessage = { type: "SCRAPE_USAGE" };
