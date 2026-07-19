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

export interface ProviderSnapshot<T extends ProviderId = ProviderId> {
  provider: T;
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

export interface ProviderState<T extends ProviderId = ProviderId> {
  id: T;
  status: ConnectionStatus;
  budgetUsd: number;
  snapshot?: ProviderSnapshot<T>;
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
  providers: { [T in ProviderId]: ProviderState<T> };
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

export type ContentMessage = { type: "SCRAPE_USAGE" };
