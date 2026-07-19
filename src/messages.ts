import { z } from "zod";
import {
  backupErrorCodeSchema,
  extensionStateSchema,
  type BackupFileV1,
} from "./backup";
import { PROVIDER_IDS, type ExtensionState } from "./types";

const finiteNumber = z.number().finite();
const providerIdSchema = z.enum(PROVIDER_IDS);

const pageUsageResultSchema = z.strictObject({
  provider: providerIdSchema,
  kind: z.enum(["usage", "auth_required", "unavailable"]),
  used: finiteNumber.optional(),
  limit: finiteNumber.optional(),
  nativeUnit: z.enum(["usd", "credits"]).optional(),
  message: z.string().optional(),
});

export const extensionMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("GET_STATE") }),
  z.strictObject({ type: z.literal("REFRESH_ALL") }),
  z.strictObject({
    type: z.literal("SAVE_SETTINGS"),
    budgets: z.strictObject({
      claude: finiteNumber,
      chatgpt: finiteNumber,
      cursor: finiteNumber,
    }),
    retentionMonths: finiteNumber,
    syncMinutes: finiteNumber,
    allowScheduledCursorFocus: z.boolean(),
  }),
  z.strictObject({
    type: z.literal("OPEN_SIGN_IN"),
    provider: providerIdSchema,
  }),
  z.strictObject({
    type: z.literal("PAGE_USAGE"),
    result: pageUsageResultSchema,
  }),
  z.strictObject({ type: z.literal("EXPORT_DATA") }),
  z.strictObject({
    type: z.literal("IMPORT_DATA"),
    backup: z.unknown(),
  }),
  z.strictObject({ type: z.literal("RESET_HISTORY") }),
]);

export type ExtensionMessage = z.infer<typeof extensionMessageSchema>;

const importDataResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    state: extensionStateSchema,
    exportedAt: z.iso.datetime({ offset: true }),
  }),
  z.strictObject({
    ok: z.literal(false),
    error: backupErrorCodeSchema,
  }),
]);

export type ImportDataResult = z.infer<typeof importDataResponseSchema>;

export interface ExtensionResponseByType {
  GET_STATE: ExtensionState;
  REFRESH_ALL: ExtensionState;
  SAVE_SETTINGS: ExtensionState;
  OPEN_SIGN_IN: ExtensionState;
  PAGE_USAGE: { ok: true };
  EXPORT_DATA: BackupFileV1;
  IMPORT_DATA: ImportDataResult;
  RESET_HISTORY: ExtensionState;
}

export type ExtensionResponse<Message extends ExtensionMessage> =
  ExtensionResponseByType[Message["type"]];

export const INVALID_EXTENSION_MESSAGE_RESPONSE = {
  error: "Invalid extension message",
} as const;

export type ExtensionMessageParseResult =
  | { ok: true; message: ExtensionMessage }
  | { ok: false };

export function parseExtensionMessage(value: unknown): ExtensionMessageParseResult {
  const parsed = extensionMessageSchema.safeParse(value);
  return parsed.success
    ? { ok: true, message: parsed.data }
    : { ok: false };
}

export function parseImportDataResponse(value: unknown): ImportDataResult | undefined {
  const parsed = importDataResponseSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
