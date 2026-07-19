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
  const pendingImportControls: Array<{
    started: ReturnType<typeof deferred<void>>;
    release: ReturnType<typeof deferred<void>>;
  }> = [];
  const pendingRefreshControls: Array<ReturnType<typeof deferred<void>>> = [];
  let alarmListener: AlarmListener | undefined;
  let messageListener: MessageListener | undefined;
  let currentRefreshControl: ReturnType<typeof deferred<void>> | undefined;
  let providersStartedInRefresh = 0;

  const collectProvider = vi.fn(async () => {
    if (providersStartedInRefresh === 0) {
      currentRefreshControl = pendingRefreshControls.shift();
    }
    const refreshControl = currentRefreshControl;
    providersStartedInRefresh = (providersStartedInRefresh + 1) % 3;
    if (providersStartedInRefresh === 0) currentRefreshControl = undefined;
    await refreshControl?.promise;
    return { kind: "auth_required" as const, message: "Sign in required" };
  });
  const restoreBackup = vi.fn(async () => {
    const control = pendingImportControls.shift();
    if (!control) throw new Error("Import control was not configured");
    control.started.resolve(undefined);
    await control.release.promise;
    return importResult;
  });
  const getState = vi.fn(async () => state);
  const saveState = vi.fn(async () => undefined);
  const updateProvider = vi.fn(async () => state);
  const alarmCreate = vi.fn(async () => undefined);
  const setBadgeText = vi.fn(async () => undefined);

  vi.stubGlobal("chrome", {
    action: {
      setBadgeBackgroundColor: vi.fn(async () => undefined),
      setBadgeText,
    },
    alarms: {
      clear: vi.fn(async () => true),
      create: alarmCreate,
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
    alarmCreate,
    collectProvider,
    controlNextImport: () => {
      const control = {
        started: deferred<void>(),
        release: deferred<void>(),
      };
      pendingImportControls.push(control);
      return control;
    },
    controlNextRefresh: () => {
      const control = deferred<void>();
      pendingRefreshControls.push(control);
      return control;
    },
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
    recordSnapshot: vi.fn(async () => state),
    resetHistory: vi.fn(async () => state),
    restoreBackup,
    saveSettings: vi.fn(async () => state),
    saveState,
    setBadgeText,
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
    const activeRefresh = harness.controlNextRefresh();
    const imported = harness.controlNextImport();
    harness.getAlarmListener()({ name: "refresh-ai-usage" });
    await vi.waitFor(() => expect(harness.collectProvider).toHaveBeenCalledTimes(3));

    const queuedRefresh = sendMessage({ type: "REFRESH_ALL" });
    const importResponse = sendMessage({ type: "IMPORT_DATA", backup: {} });

    expect(harness.restoreBackup).not.toHaveBeenCalled();

    activeRefresh.resolve(undefined);
    await imported.started.promise;
    await flushWorkerTasks();

    expect(harness.collectProvider).toHaveBeenCalledTimes(3);

    imported.release.resolve(undefined);
    await expect(importResponse).resolves.toEqual(harness.importResult);
    await queuedRefresh;

    expect(harness.collectProvider).toHaveBeenCalledTimes(6);
  });

  it("keeps refresh blocked across two serialized imports", async () => {
    const collectionCount = harness.collectProvider.mock.calls.length;
    const importA = harness.controlNextImport();
    const importB = harness.controlNextImport();
    const responseA = sendMessage({ type: "IMPORT_DATA", backup: { id: "A" } });

    await importA.started.promise;

    const responseB = sendMessage({ type: "IMPORT_DATA", backup: { id: "B" } });
    const refreshResponse = sendMessage({ type: "REFRESH_ALL" });

    expect(harness.collectProvider).toHaveBeenCalledTimes(collectionCount);

    importA.release.resolve(undefined);
    await importB.started.promise;
    await flushWorkerTasks();

    expect(harness.collectProvider).toHaveBeenCalledTimes(collectionCount);

    importB.release.resolve(undefined);
    await expect(responseA).resolves.toEqual(harness.importResult);
    await expect(responseB).resolves.toEqual(harness.importResult);
    await refreshResponse;

    expect(harness.collectProvider).toHaveBeenCalledTimes(collectionCount + 3);
  });

  it("keeps a completed restore successful when alarm and badge updates fail", async () => {
    const collectionCount = harness.collectProvider.mock.calls.length;
    const imported = harness.controlNextImport();
    harness.alarmCreate.mockRejectedValueOnce(new Error("Alarm unavailable"));
    harness.setBadgeText.mockRejectedValueOnce(new Error("Badge unavailable"));

    const response = sendMessage({ type: "IMPORT_DATA", backup: {} });
    await imported.started.promise;
    imported.release.resolve(undefined);

    await expect(response).resolves.toEqual(harness.importResult);
    expect(harness.alarmCreate).toHaveBeenCalledWith(
      "refresh-ai-usage",
      { periodInMinutes: harness.importResult.state.settings.syncMinutes },
    );
    expect(harness.setBadgeText).toHaveBeenCalledWith({ text: "" });
    expect(harness.collectProvider).toHaveBeenCalledTimes(collectionCount);
  });
});
