import { describe, expect, expectTypeOf, it } from "vitest";
import {
  parseExtensionMessage,
  parseImportDataResponse,
  type ExtensionMessage,
  type ExtensionResponse,
} from "../src/messages";
import { createInitialState } from "../src/state";
import type { ExtensionState } from "../src/types";

describe("extension message protocol", () => {
  it.each<ExtensionMessage>([
    { type: "GET_STATE" },
    { type: "REFRESH_ALL" },
    {
      type: "SAVE_SETTINGS",
      budgets: { claude: 1_000, chatgpt: 1_000, cursor: 1_000 },
      retentionMonths: 12,
      syncMinutes: 30,
      allowScheduledCursorFocus: true,
    },
    { type: "OPEN_SIGN_IN", provider: "claude" },
    {
      type: "PAGE_USAGE",
      result: {
        provider: "chatgpt",
        kind: "usage",
        used: 20,
        limit: 100,
        nativeUnit: "usd",
      },
    },
    { type: "EXPORT_DATA" },
    { type: "IMPORT_DATA", backup: null },
    { type: "RESET_HISTORY" },
  ])("accepts the $type request shape", (message) => {
    expect(parseExtensionMessage(message)).toEqual({ ok: true, message });
  });

  it.each([
    null,
    { type: "UNKNOWN" },
    { type: "GET_STATE", unexpected: true },
    { type: "OPEN_SIGN_IN", provider: "other" },
    { type: "IMPORT_DATA" },
    {
      type: "PAGE_USAGE",
      result: { provider: "claude", kind: "usage", used: "many" },
    },
  ])("rejects malformed request data", (message) => {
    expect(parseExtensionMessage(message)).toEqual({ ok: false });
  });

  it("maps request types to their response types", () => {
    expectTypeOf<ExtensionResponse<{ type: "GET_STATE" }>>()
      .toEqualTypeOf<ExtensionState>();
    expectTypeOf<ExtensionResponse<{ type: "PAGE_USAGE"; result: {
      provider: "claude";
      kind: "auth_required";
    } }>>().toEqualTypeOf<{ ok: true }>();
  });
});

describe("import response protocol", () => {
  it("accepts a validated successful import response", () => {
    const response = {
      ok: true as const,
      state: createInitialState(),
      exportedAt: "2026-07-19T12:00:00.000Z",
    };

    expect(parseImportDataResponse(response)).toEqual(response);
  });

  it("rejects a malformed successful import response", () => {
    const state = createInitialState();
    state.settings.syncMinutes = 0;

    expect(parseImportDataResponse({
      ok: true,
      state,
      exportedAt: "2026-07-19T12:00:00.000Z",
    })).toBeUndefined();
  });
});
