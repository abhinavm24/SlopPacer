import { z } from "zod";
import type { ExtensionState, ProviderId } from "./types";

const BACKUP_FORMAT = "slop-pacer-backup";
const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 1024 * 1024;

const isoDate = z.iso.date();
export const isoDateTimeSchema = z.iso.datetime({ offset: true });
const finiteNumber = z.number().finite();
const nonNegativeNumber = finiteNumber.nonnegative();
const connectionStatus = z.enum([
  "not_configured",
  "checking",
  "connected",
  "page_required",
  "auth_required",
  "retryable_error",
  "error",
]);

export const dailyUsageSchema = z.strictObject({
  date: isoDate,
  equivalentUsedUsd: finiteNumber,
  actualUsedUsd: finiteNumber.optional(),
  nativeUsed: finiteNumber.optional(),
});

function providerSnapshotSchema<const T extends ProviderId>(provider: T) {
  return z.strictObject({
    provider: z.literal(provider),
    capturedAt: isoDateTimeSchema,
    cycleStart: isoDate,
    cycleEnd: isoDate,
    nativeUnit: z.enum(["usd", "credits"]),
    nativeUsed: nonNegativeNumber,
    nativeLimit: nonNegativeNumber,
    budgetUsd: nonNegativeNumber,
    actualUsedUsd: nonNegativeNumber.optional(),
    equivalentUsedUsd: nonNegativeNumber,
    remainingUsd: nonNegativeNumber,
    utilizationPercent: nonNegativeNumber,
    source: z.enum(["api", "page"]),
    pendingUsd: nonNegativeNumber.optional(),
  });
}

export function providerStateSchema<const T extends ProviderId>(provider: T) {
  return z.strictObject({
    id: z.literal(provider),
    status: connectionStatus,
    budgetUsd: nonNegativeNumber,
    snapshot: providerSnapshotSchema(provider).optional(),
    history: z.array(dailyUsageSchema),
    message: z.string().optional(),
    lastAttemptAt: isoDateTimeSchema.optional(),
    lastSuccessAt: isoDateTimeSchema.optional(),
  });
}

export const extensionSettingsSchema = z.strictObject({
  retentionMonths: z.number().int().min(1).max(24),
  syncMinutes: z.number().int().min(1).max(1440),
  allowScheduledCursorFocus: z.boolean(),
});

export const extensionStateSchema = z.strictObject({
  schemaVersion: z.literal(3),
  providers: z.strictObject({
    claude: providerStateSchema("claude"),
    chatgpt: providerStateSchema("chatgpt"),
    cursor: providerStateSchema("cursor"),
  }),
  settings: extensionSettingsSchema,
  lastRefreshAt: isoDateTimeSchema.optional(),
});

type Assert<T extends true> = T;
type IsBidirectionallyAssignable<Left, Right> =
  [Left] extends [Right]
    ? [Right] extends [Left]
      ? true
      : false
    : false;
export type ExtensionStateSchemaConformance = Assert<
  IsBidirectionallyAssignable<z.infer<typeof extensionStateSchema>, ExtensionState>
>;

const backupFileV1Schema = z.strictObject({
  format: z.literal(BACKUP_FORMAT),
  formatVersion: z.literal(BACKUP_VERSION),
  exportedAt: isoDateTimeSchema,
  state: extensionStateSchema,
});

export type BackupFileV1 = z.infer<typeof backupFileV1Schema>;
export const backupErrorCodeSchema = z.enum([
  "invalid_json",
  "invalid_format",
  "unsupported_version",
  "invalid_data",
  "import_failed",
]);
export type BackupErrorCode = z.infer<typeof backupErrorCodeSchema>;

export type BackupParseResult =
  | { ok: true; backup: BackupFileV1 }
  | { ok: false; error: BackupErrorCode };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createBackup(
  state: ExtensionState,
  exportedAt = new Date().toISOString(),
): BackupFileV1 {
  return backupFileV1Schema.parse({
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_VERSION,
    exportedAt,
    state,
  });
}

export function parseExtensionState(value: unknown): ExtensionState | undefined {
  const parsed = extensionStateSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function parseBackupValue(value: unknown): BackupParseResult {
  if (!isRecord(value) || value.format !== BACKUP_FORMAT) {
    return { ok: false, error: "invalid_format" };
  }
  if (value.formatVersion !== BACKUP_VERSION) {
    return { ok: false, error: "unsupported_version" };
  }
  const parsed = backupFileV1Schema.safeParse(value);
  if (!parsed.success) return { ok: false, error: "invalid_data" };
  return { ok: true, backup: parsed.data };
}

export function parseBackupText(text: string): BackupParseResult {
  try {
    return parseBackupValue(JSON.parse(text) as unknown);
  } catch {
    return { ok: false, error: "invalid_json" };
  }
}

export function backupErrorMessage(code: BackupErrorCode): string {
  switch (code) {
    case "invalid_json":
      return "That file does not contain valid JSON.";
    case "invalid_format":
      return "That file is not a Slop Pacer backup.";
    case "unsupported_version":
      return "This backup version is not supported.";
    case "invalid_data":
      return "The backup contains invalid Slop Pacer data.";
    case "import_failed":
      return "Slop Pacer could not restore that backup.";
    default: {
      const exhaustiveCode: never = code;
      return exhaustiveCode;
    }
  }
}
