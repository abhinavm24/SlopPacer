// @vitest-environment jsdom

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_BACKUP_BYTES,
  createBackup,
  type BackupFileV1,
} from "../src/backup";
import type { ExtensionMessage } from "../src/messages";
import { normalizeUsd } from "../src/normalization";
import { createInitialState } from "../src/state";
import type { ExtensionState, ProviderSnapshot } from "../src/types";

function stateWithClaudeSnapshot(budgets?: Partial<Record<"claude" | "chatgpt" | "cursor", number>>): ExtensionState {
  const state = createInitialState();
  if (budgets?.claude !== undefined) state.providers.claude.budgetUsd = budgets.claude;
  if (budgets?.chatgpt !== undefined) state.providers.chatgpt.budgetUsd = budgets.chatgpt;
  if (budgets?.cursor !== undefined) state.providers.cursor.budgetUsd = budgets.cursor;
  state.providers.claude.snapshot = normalizeUsd(
    "claude",
    400,
    state.providers.claude.budgetUsd,
    "2026-07-17T12:00:00.000Z",
    "2026-07-01",
    "2026-07-31",
    "page",
  ) as ProviderSnapshot<"claude">;
  state.providers.claude.history = [{ date: "2026-07-17", equivalentUsedUsd: 400 }];
  return state;
}

const testModuleUrl = new URL(import.meta.url);
if (testModuleUrl.protocol !== "file:") {
  testModuleUrl.href = pathToFileURL(import.meta.filename).href;
}
const popupMarkup = await readFile(new URL("../popup.html", testModuleUrl), "utf8");
const exportedAt = "2026-07-19T12:00:00.000Z";

type MessageHandler = (message: ExtensionMessage) => unknown | Promise<unknown>;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsText(blob);
  });
}

function createFile(backup: BackupFileV1) {
  const text = JSON.stringify(backup);
  const readText = vi.fn(async () => text);
  return {
    file: {
      size: new Blob([text]).size,
      text: readText,
    } as unknown as File,
    readText,
  };
}

function selectFile(input: HTMLInputElement, file: File): void {
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [file],
  });
  Object.defineProperty(input, "value", {
    configurable: true,
    value: "C:\\fakepath\\backup.json",
    writable: true,
  });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function setupPopup(
  handleMessage: MessageHandler = () => {
    throw new Error("Unexpected popup message");
  },
  initialState: ExtensionState = createInitialState(),
) {
  vi.resetModules();
  document.open();
  document.write(popupMarkup);
  document.close();

  const sendMessage = vi.fn((message: ExtensionMessage) => {
    if (message.type === "GET_STATE") return Promise.resolve(initialState);
    return Promise.resolve(handleMessage(message));
  });
  const confirmImport = vi.fn(() => true);
  const createObjectURL = vi.fn((_blob: Blob) => "blob:backup");
  const revokeObjectURL = vi.fn((_url: string) => undefined);
  class TestUrl extends URL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = revokeObjectURL;
  }

  vi.stubGlobal("chrome", { runtime: { sendMessage } });
  vi.stubGlobal("confirm", confirmImport);
  vi.stubGlobal("URL", TestUrl);
  const downloadClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

  await import("../src/popup");
  await vi.waitFor(() => {
    expect(document.querySelector("#providers")?.children).toHaveLength(3);
  });

  return {
    confirmImport,
    createObjectURL,
    dataStatus: document.querySelector<HTMLOutputElement>("#data-status")!,
    downloadClick,
    exportButton: document.querySelector<HTMLButtonElement>("#export")!,
    importButton: document.querySelector<HTMLButtonElement>("#import")!,
    importFile: document.querySelector<HTMLInputElement>("#import-file")!,
    resetButton: document.querySelector<HTMLButtonElement>("#reset")!,
    revokeObjectURL,
    sendMessage,
  };
}

function expectDataControlsEnabled(
  controls: Pick<Awaited<ReturnType<typeof setupPopup>>, "exportButton" | "importButton" | "resetButton">,
): void {
  expect(controls.exportButton.disabled).toBe(false);
  expect(controls.importButton.disabled).toBe(false);
  expect(controls.resetButton.disabled).toBe(false);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("popup backup import behavior", () => {
  it("rejects an oversized file before reading or sending it", async () => {
    const popup = await setupPopup();
    const readText = vi.fn(async () => "{}");
    const file = {
      size: MAX_BACKUP_BYTES + 1,
      text: readText,
    } as unknown as File;

    selectFile(popup.importFile, file);

    await vi.waitFor(() => {
      expect(popup.dataStatus.textContent).toBe("The selected backup is larger than 1 MiB.");
    });
    expect(readText).not.toHaveBeenCalled();
    expect(popup.confirmImport).not.toHaveBeenCalled();
    expect(popup.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "IMPORT_DATA" }),
    );
    expect(popup.importFile.value).toBe("");
    expectDataControlsEnabled(popup);
  });

  it("does not import when confirmation is cancelled", async () => {
    const popup = await setupPopup();
    popup.confirmImport.mockReturnValue(false);
    const { file } = createFile(createBackup(createInitialState(), exportedAt));

    selectFile(popup.importFile, file);

    await vi.waitFor(() => {
      expect(popup.dataStatus.textContent).toBe("Import cancelled");
    });
    expect(popup.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "IMPORT_DATA" }),
    );
    expect(popup.importFile.value).toBe("");
    expectDataControlsEnabled(popup);
  });

  it("reports malformed JSON without importing and recovers the controls", async () => {
    const popup = await setupPopup();
    const file = {
      size: 1,
      text: vi.fn(async () => "{"),
    } as unknown as File;

    selectFile(popup.importFile, file);

    await vi.waitFor(() => {
      expect(popup.dataStatus.textContent).toBe("That file does not contain valid JSON.");
    });
    expect(popup.confirmImport).not.toHaveBeenCalled();
    expect(popup.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "IMPORT_DATA" }),
    );
    expect(popup.importFile.value).toBe("");
    expectDataControlsEnabled(popup);
  });

  it.each([
    {
      name: "a typed worker failure",
      response: () => ({ ok: false, error: "invalid_data" }),
      status: "The backup contains invalid Slop Pacer data.",
    },
    {
      name: "a malformed worker response",
      response: () => ({
        ok: true,
        state: {
          ...createInitialState(),
          settings: {
            ...createInitialState().settings,
            syncMinutes: 0,
          },
        },
        exportedAt,
      }),
      status: "Slop Pacer could not restore that backup.",
    },
    {
      name: "a rejected worker request",
      response: () => Promise.reject(new Error("Worker unavailable")),
      status: "Worker unavailable",
    },
  ])("does not render $name and recovers the controls", async ({ response, status }) => {
    const popup = await setupPopup((message) => {
      if (message.type === "IMPORT_DATA") return response();
      throw new Error(`Unexpected ${message.type} message`);
    }, stateWithClaudeSnapshot());
    const originalMonth = document.querySelector("#month-label")?.textContent;
    const importedState = stateWithClaudeSnapshot({ claude: 9_000 });
    const { file } = createFile(createBackup(importedState, exportedAt));

    selectFile(popup.importFile, file);

    await vi.waitFor(() => {
      expect(popup.dataStatus.textContent).toBe(status);
    });
    expect(document.querySelector("#month-label")?.textContent).toBe(originalMonth);
    expect(popup.dataStatus.classList.contains("error")).toBe(true);
    expect(popup.importFile.value).toBe("");
    expectDataControlsEnabled(popup);
  });

  it("renders imported state and settings after a successful worker response", async () => {
    const workerResponse = deferred<unknown>();
    const popup = await setupPopup((message) => {
      if (message.type === "IMPORT_DATA") return workerResponse.promise;
      throw new Error(`Unexpected ${message.type} message`);
    }, stateWithClaudeSnapshot());
    const importedState = stateWithClaudeSnapshot({ claude: 900, chatgpt: 800, cursor: 700 });
    importedState.settings.syncMinutes = 60;
    importedState.settings.retentionMonths = 6;
    importedState.settings.allowScheduledCursorFocus = true;
    const backup = createBackup(importedState, exportedAt);
    const { file } = createFile(backup);
    const originalMonth = document.querySelector("#month-label")?.textContent;
    expect(originalMonth).toBe("$400 / $6,000");

    selectFile(popup.importFile, file);
    await vi.waitFor(() => {
      expect(popup.sendMessage).toHaveBeenCalledWith({
        type: "IMPORT_DATA",
        backup,
      });
    });
    expect(popup.exportButton.disabled).toBe(true);
    expect(popup.importButton.disabled).toBe(true);
    expect(popup.resetButton.disabled).toBe(true);

    workerResponse.resolve({ ok: true, state: importedState, exportedAt });

    await vi.waitFor(() => {
      expect(popup.dataStatus.textContent).toContain("Imported backup from");
    });
    expect(document.querySelector("#month-label")?.textContent).toBe("$400 / $2,400");
    expect((document.querySelector('[name="claude"]') as HTMLInputElement).value).toBe("900");
    expect((document.querySelector('[name="syncMinutes"]') as HTMLInputElement).value).toBe("60");
    expect((document.querySelector('[name="retentionMonths"]') as HTMLInputElement).value).toBe("6");
    expect((document.querySelector('[name="allowScheduledCursorFocus"]') as HTMLInputElement).checked).toBe(true);
    expect(popup.importFile.value).toBe("");
    expectDataControlsEnabled(popup);
  });

  it("allows the same file to be selected again after cancellation", async () => {
    const importedState = createInitialState();
    const backup = createBackup(importedState, exportedAt);
    const popup = await setupPopup((message) => {
      if (message.type === "IMPORT_DATA") {
        return { ok: true, state: importedState, exportedAt };
      }
      throw new Error(`Unexpected ${message.type} message`);
    });
    popup.confirmImport
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const { file, readText } = createFile(backup);

    selectFile(popup.importFile, file);
    await vi.waitFor(() => {
      expect(popup.dataStatus.textContent).toBe("Import cancelled");
    });

    selectFile(popup.importFile, file);
    await vi.waitFor(() => {
      expect(popup.dataStatus.textContent).toContain("Imported backup from");
    });

    expect(readText).toHaveBeenCalledTimes(2);
    const importCalls = popup.sendMessage.mock.calls.filter(
      ([message]) => message.type === "IMPORT_DATA",
    );
    expect(importCalls).toEqual([[{ type: "IMPORT_DATA", backup }]]);
    expect(popup.importFile.value).toBe("");
    expectDataControlsEnabled(popup);
  });
});

describe("popup backup export behavior", () => {
  it.each([
    {
      name: "an invalid response",
      response: () => ({ format: "not-slop-pacer" }),
    },
    {
      name: "a rejected worker request",
      response: () => Promise.reject(new Error("Worker unavailable")),
    },
  ])("does not download $name and recovers the controls", async ({ response }) => {
    const popup = await setupPopup((message) => {
      if (message.type === "EXPORT_DATA") return response();
      throw new Error(`Unexpected ${message.type} message`);
    });

    popup.exportButton.click();
    expect(popup.exportButton.disabled).toBe(true);
    expect(popup.importButton.disabled).toBe(true);
    expect(popup.resetButton.disabled).toBe(true);

    await vi.waitFor(() => {
      expect(popup.dataStatus.textContent).toBe("Slop Pacer could not export a backup.");
    });
    expect(popup.dataStatus.classList.contains("error")).toBe(true);
    expect(popup.createObjectURL).not.toHaveBeenCalled();
    expect(popup.downloadClick).not.toHaveBeenCalled();
    expectDataControlsEnabled(popup);
  });

  it("downloads only a validated backup and reports success", async () => {
    const backup = createBackup(createInitialState(), exportedAt);
    const popup = await setupPopup((message) => {
      if (message.type === "EXPORT_DATA") return backup;
      throw new Error(`Unexpected ${message.type} message`);
    });

    popup.exportButton.click();

    await vi.waitFor(() => {
      expect(popup.dataStatus.textContent).toBe("Backup exported");
    });
    expect(popup.createObjectURL).toHaveBeenCalledOnce();
    expect(popup.downloadClick).toHaveBeenCalledOnce();
    const blob = popup.createObjectURL.mock.calls[0]![0];
    expect(blob.type).toBe("application/json");
    expect(JSON.parse(await readBlobText(blob))).toEqual(backup);
    const link = popup.downloadClick.mock.contexts[0] as HTMLAnchorElement;
    expect(link.download).toBe(`slop-pacer-${new Date().toISOString().slice(0, 10)}.json`);
    expect(popup.revokeObjectURL).toHaveBeenCalledWith("blob:backup");
    expectDataControlsEnabled(popup);
  });
});
