import { afterAll, describe, expect, it, vi } from "vitest";
import type { BackupFileV1, ImportDataResult } from "../src/backup";
import type { ExtensionMessage } from "../src/types";
import "../src/background";

type AlarmListener = (alarm: { name: string }) => void;
type MessageListener = (
  message: ExtensionMessage,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean;

const harness = vi.hoisted(() => {
  function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((resolvePromise) => {
      resolve = resolvePromise;
    });
    return { promise, resolve };
  }

  const state: BackupFileV1["state"] = {
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
  const importResult: ImportDataResult = {
    ok: true,
    state,
    exportedAt: "2026-07-19T12:00:00.000Z",
  };
  const releaseRefresh = deferred<void>();
  const importStarted = deferred<void>();
  const releaseImport = deferred<void>();
  let alarmListener: AlarmListener | undefined;
  let messageListener: MessageListener | undefined;
  let collectionCount = 0;

  const collectProvider = vi.fn(async () => {
    collectionCount += 1;
    if (collectionCount <= 3) await releaseRefresh.promise;
    return { kind: "auth_required" as const, message: "Sign in required" };
  });
  const restoreBackup = vi.fn(async () => {
    importStarted.resolve(undefined);
    await releaseImport.promise;
    return importResult;
  });
  const getState = vi.fn(async () => state);
  const saveState = vi.fn(async () => undefined);
  const updateProvider = vi.fn(async () => state);

  vi.stubGlobal("chrome", {
    action: {
      setBadgeBackgroundColor: vi.fn(async () => undefined),
      setBadgeText: vi.fn(async () => undefined),
    },
    alarms: {
      clear: vi.fn(async () => true),
      create: vi.fn(async () => undefined),
      onAlarm: {
        addListener: vi.fn((listener: AlarmListener) => {
          alarmListener = listener;
        }),
      },
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
        get: vi.fn(async () => ({ aiUsageMeterState: state })),
        set: vi.fn(async () => undefined),
      },
    },
    tabs: {
      create: vi.fn(async () => undefined),
    },
  });

  return {
    collectProvider,
    createInitialState: vi.fn(() => state),
    getAlarmListener: () => {
      if (!alarmListener) throw new Error("Alarm listener was not registered");
      return alarmListener;
    },
    getMessageListener: () => {
      if (!messageListener) throw new Error("Message listener was not registered");
      return messageListener;
    },
    getState,
    importResult,
    importStarted,
    recordSnapshot: vi.fn(async () => state),
    releaseImport,
    releaseRefresh,
    resetHistory: vi.fn(async () => state),
    restoreBackup,
    saveSettings: vi.fn(async () => state),
    saveState,
    updateProvider,
  };
});

vi.mock("../src/collectors", () => ({
  collectProvider: harness.collectProvider,
  normalizePageResult: vi.fn(),
}));

vi.mock("../src/state", () => ({
  createInitialState: harness.createInitialState,
  getState: harness.getState,
  recordSnapshot: harness.recordSnapshot,
  resetHistory: harness.resetHistory,
  restoreBackup: harness.restoreBackup,
  saveSettings: harness.saveSettings,
  saveState: harness.saveState,
  updateProvider: harness.updateProvider,
}));

function sendMessage(message: ExtensionMessage): Promise<unknown> {
  return new Promise((resolve) => {
    expect(harness.getMessageListener()(message, undefined, resolve)).toBe(true);
  });
}

async function flushWorkerTasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("background import coordination", () => {
  afterAll(() => vi.unstubAllGlobals());

  it("serializes import between an active refresh and its queued visible refresh", async () => {
    harness.getAlarmListener()({ name: "refresh-ai-usage" });
    await vi.waitFor(() => expect(harness.collectProvider).toHaveBeenCalledTimes(3));

    const queuedRefresh = sendMessage({ type: "REFRESH_ALL" });
    const importResponse = sendMessage({ type: "IMPORT_DATA", backup: {} });

    expect(harness.restoreBackup).not.toHaveBeenCalled();

    harness.releaseRefresh.resolve(undefined);
    await harness.importStarted.promise;
    await flushWorkerTasks();

    expect(harness.collectProvider).toHaveBeenCalledTimes(3);

    harness.releaseImport.resolve(undefined);
    await expect(importResponse).resolves.toEqual(harness.importResult);
    await queuedRefresh;

    expect(harness.collectProvider).toHaveBeenCalledTimes(6);
  });
});
