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
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return { promise, reject, resolve };
  }

  function createTaskControl() {
    return {
      started: deferred<void>(),
      release: deferred<void>(),
    };
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
  const pendingImportControls: Array<ReturnType<typeof createTaskControl>> = [];
  const pendingPageUsageControls: Array<ReturnType<typeof createTaskControl>> = [];
  const pendingRefreshControls: Array<ReturnType<typeof deferred<void>>> = [];
  let alarmListener: AlarmListener | undefined;
  let messageListener: MessageListener | undefined;
  let currentRefreshControl: ReturnType<typeof deferred<void>> | undefined;
  let lastPersistentWrite = "initial";
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
    if (control) {
      control.started.resolve(undefined);
      await control.release.promise;
    }
    lastPersistentWrite = "import";
    return importResult;
  });
  const getState = vi.fn(async () => state);
  const saveState = vi.fn(async () => undefined);
  const updateProvider = vi.fn(async () => state);
  const recordSnapshot = vi.fn(async () => {
    const control = pendingPageUsageControls.shift();
    if (control) {
      control.started.resolve(undefined);
      await control.release.promise;
      lastPersistentWrite = "page_usage";
    }
    return state;
  });
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
      const control = createTaskControl();
      pendingImportControls.push(control);
      return control;
    },
    controlNextPageUsage: () => {
      const control = createTaskControl();
      pendingPageUsageControls.push(control);
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
    getLastPersistentWrite: () => lastPersistentWrite,
    importResult,
    normalizePageResult: vi.fn(() => ({
      kind: "success" as const,
      snapshot: {
        provider: "claude" as const,
        capturedAt: "2026-07-19T12:00:00.000Z",
        cycleStart: "2026-07-01",
        cycleEnd: "2026-07-31",
        nativeUnit: "usd" as const,
        nativeUsed: 10,
        nativeLimit: 100,
        budgetUsd: 2_000,
        actualUsedUsd: 10,
        equivalentUsedUsd: 10,
        remainingUsd: 1_990,
        utilizationPercent: 0.5,
        source: "page" as const,
      },
    })),
    recordSnapshot,
    resetHistory: vi.fn(async () => state),
    restoreBackup,
    saveSettings: vi.fn(async () => state),
    saveState,
    setLastPersistentWrite: (value: string) => {
      lastPersistentWrite = value;
    },
    setBadgeText,
    updateProvider,
  };
});

vi.mock("../src/collectors", () => ({
  collectProvider: harness.collectProvider,
  normalizePageResult: harness.normalizePageResult,
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

  it("imports after an in-flight page usage write so restored state remains authoritative", async () => {
    const pageUsage = harness.controlNextPageUsage();
    harness.setLastPersistentWrite("initial");
    const pageResponse = sendMessage({
      type: "PAGE_USAGE",
      result: {
        provider: "claude",
        kind: "usage",
        used: 10,
        limit: 100,
        nativeUnit: "usd",
      },
    });
    await pageUsage.started.promise;

    const importResponse = sendMessage({ type: "IMPORT_DATA", backup: {} });
    await flushWorkerTasks();
    pageUsage.release.resolve(undefined);

    await expect(pageResponse).resolves.toEqual({ ok: true });
    await expect(importResponse).resolves.toEqual(harness.importResult);
    expect(harness.getLastPersistentWrite()).toBe("import");
  });

  it("runs a valid import after a rejected refresh", async () => {
    const collectionCount = harness.collectProvider.mock.calls.length;
    const failedRefresh = harness.controlNextRefresh();
    const refreshResponse = sendMessage({ type: "REFRESH_ALL" });
    await vi.waitFor(() => {
      expect(harness.collectProvider).toHaveBeenCalledTimes(collectionCount + 3);
    });

    const importResponse = sendMessage({ type: "IMPORT_DATA", backup: {} });
    failedRefresh.reject(new Error("Refresh failed"));

    await expect(refreshResponse).resolves.toEqual({ error: "Refresh failed" });
    await expect(importResponse).resolves.toEqual(harness.importResult);
  });

  it("runs queued import and refresh work after a rejected import", async () => {
    const collectionCount = harness.collectProvider.mock.calls.length;
    const failedImport = harness.controlNextImport();
    const failedResponse = sendMessage({ type: "IMPORT_DATA", backup: { id: "failed" } });
    await failedImport.started.promise;

    const importResponse = sendMessage({ type: "IMPORT_DATA", backup: { id: "valid" } });
    const refreshResponse = sendMessage({ type: "REFRESH_ALL" });
    failedImport.release.reject(new Error("Import failed"));

    await expect(failedResponse).resolves.toEqual({ ok: false, error: "import_failed" });
    await expect(importResponse).resolves.toEqual(harness.importResult);
    await expect(refreshResponse).resolves.toEqual(harness.importResult.state);
    expect(harness.collectProvider).toHaveBeenCalledTimes(collectionCount + 3);
  });

  it("queues settings, reset, and sign-in state writes behind import", async () => {
    const importControl = harness.controlNextImport();
    const importResponse = sendMessage({ type: "IMPORT_DATA", backup: {} });
    await importControl.started.promise;
    const saveSettingsCount = harness.saveSettings.mock.calls.length;
    const resetHistoryCount = harness.resetHistory.mock.calls.length;
    const updateProviderCount = harness.updateProvider.mock.calls.length;

    const settingsResponse = sendMessage({
      type: "SAVE_SETTINGS",
      budgets: { claude: 1_000, chatgpt: 1_000, cursor: 1_000 },
      retentionMonths: 12,
      syncMinutes: 30,
      allowScheduledCursorFocus: false,
    });
    const resetResponse = sendMessage({ type: "RESET_HISTORY" });
    const signInResponse = sendMessage({ type: "OPEN_SIGN_IN", provider: "claude" });
    await flushWorkerTasks();
    const callsDuringImport = {
      resetHistory: harness.resetHistory.mock.calls.length,
      saveSettings: harness.saveSettings.mock.calls.length,
      updateProvider: harness.updateProvider.mock.calls.length,
    };

    importControl.release.resolve(undefined);
    await Promise.all([importResponse, settingsResponse, resetResponse, signInResponse]);

    expect(callsDuringImport).toEqual({
      resetHistory: resetHistoryCount,
      saveSettings: saveSettingsCount,
      updateProvider: updateProviderCount,
    });
  });
});
