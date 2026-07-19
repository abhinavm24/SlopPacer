import { afterAll, describe, expect, it, vi } from "vitest";
import type { ExtensionState } from "../src/types";
import "../src/background";

type MessageListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean;

const harness = vi.hoisted(() => {
  const state: ExtensionState = {
    schemaVersion: 3,
    providers: {
      claude: { id: "claude", status: "connected", budgetUsd: 2_000, history: [] },
      chatgpt: { id: "chatgpt", status: "connected", budgetUsd: 2_000, history: [] },
      cursor: { id: "cursor", status: "connected", budgetUsd: 2_000, history: [] },
    },
    settings: {
      retentionMonths: 13,
      syncMinutes: 15,
      allowScheduledCursorFocus: false,
    },
  };
  let messageListener: MessageListener | undefined;
  const alarmClear = vi.fn(async () => true);
  const alarmCreate = vi.fn(async () => undefined);
  const collectProvider = vi.fn();
  const setBadgeBackgroundColor = vi.fn(async () => undefined);
  const setBadgeText = vi.fn(async () => undefined);
  const storageGet = vi.fn(async () => ({ aiUsageMeterState: state }));
  const storageSet = vi.fn(async () => undefined);

  vi.stubGlobal("chrome", {
    action: {
      setBadgeBackgroundColor,
      setBadgeText,
    },
    alarms: {
      clear: alarmClear,
      create: alarmCreate,
      onAlarm: { addListener: vi.fn() },
    },
    runtime: {
      onInstalled: { addListener: vi.fn() },
      onMessage: {
        addListener: vi.fn((listener: MessageListener) => {
          messageListener = listener;
        }),
      },
      onStartup: { addListener: vi.fn() },
    },
    storage: {
      local: {
        get: storageGet,
        set: storageSet,
      },
    },
    tabs: {
      create: vi.fn(async () => undefined),
    },
  });

  return {
    alarmClear,
    alarmCreate,
    collectProvider,
    getMessageListener: () => {
      if (!messageListener) throw new Error("Message listener was not registered");
      return messageListener;
    },
    setBadgeBackgroundColor,
    setBadgeText,
    storageGet,
    storageSet,
  };
});

vi.mock("../src/collectors", () => ({
  collectProvider: harness.collectProvider,
  normalizePageResult: vi.fn(),
}));

function sendMessage(message: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    expect(harness.getMessageListener()(message, undefined, resolve)).toBe(true);
  });
}

describe("background invalid import handling", () => {
  afterAll(() => vi.unstubAllGlobals());

  it("returns a typed failure without storage or post-import side effects", async () => {
    await vi.waitFor(() => {
      expect(harness.alarmCreate).toHaveBeenCalledOnce();
    });
    harness.alarmClear.mockClear();
    harness.alarmCreate.mockClear();
    harness.collectProvider.mockClear();
    harness.setBadgeBackgroundColor.mockClear();
    harness.setBadgeText.mockClear();
    harness.storageGet.mockClear();
    harness.storageSet.mockClear();

    await expect(sendMessage({
      type: "IMPORT_DATA",
      backup: {
        format: "slop-pacer-backup",
        formatVersion: 2,
      },
    })).resolves.toEqual({
      ok: false,
      error: "unsupported_version",
    });

    expect(harness.storageSet).not.toHaveBeenCalled();
    expect(harness.alarmClear).not.toHaveBeenCalled();
    expect(harness.alarmCreate).not.toHaveBeenCalled();
    expect(harness.setBadgeBackgroundColor).not.toHaveBeenCalled();
    expect(harness.setBadgeText).not.toHaveBeenCalled();
    expect(harness.collectProvider).not.toHaveBeenCalled();
  });
});
