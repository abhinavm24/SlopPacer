# Data Backup and Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add versioned full-state JSON export and validated replace-all import to the Slop Pacer extension.

**Architecture:** A pure `backup.ts` module owns the versioned Zod schema, serialization, parsing, and user-facing validation errors. The popup handles local file I/O and confirmation, while the background worker revalidates and replaces state, waits out any active refresh, reapplies the imported schedule, and updates the badge.

**Tech Stack:** TypeScript 7, Zod 4, Chrome Extension Manifest V3 APIs, Vitest 4, Vite 8, HTML, and CSS.

## Global Constraints

- Require Node.js 22+ and pnpm 11+.
- Keep Chrome compatibility at version 120 or newer.
- Keep backup and restore entirely local; never upload file contents or contact provider sites.
- Import replaces all local Slop Pacer state only after confirmation.
- Accept only `format: "slop-pacer-backup"` with `formatVersion: 1`; reject existing raw-state exports.
- Reject files larger than 1 MiB.
- Do not trigger a provider refresh after import.
- Use top-level imports only.
- Any new `switch` over a union must include a `never` default check.
- Preserve the pre-existing uncommitted history-chart changes in `README.md`, `popup.html`, `src/popup.ts`, `src/styles.css`, `src/history-chart.ts`, and `tests/history-chart.test.ts`.
- Never stage the four shared dirty files wholesale. Tasks 3 and 4 leave their shared-file edits uncommitted unless the owner first commits or explicitly authorizes including the history-chart work.

---

## File Structure

- Create `src/backup.ts`: versioned backup schema, envelope creation, parsing, error codes, and error copy.
- Create `tests/backup.test.ts`: backup format and validation tests.
- Modify `src/state.ts`: testable restore operation that validates before replacing storage.
- Modify `tests/state.test.ts`: full-state replacement and invalid-input persistence tests.
- Modify `src/types.ts`: add the `IMPORT_DATA` runtime message.
- Modify `src/background.ts`: return envelopes on export and orchestrate safe import.
- Create `tests/popup-backup-controls.test.ts`: static accessibility contract for popup backup controls.
- Modify `popup.html`: import button, file input, dedicated status output, and updated privacy copy.
- Modify `src/popup.ts`: export envelope download and import file workflow.
- Modify `src/styles.css`: hidden input, disabled controls, and status styling.
- Modify `README.md`: document export and replace-all restore.

### Task 1: Versioned Backup Format

**Files:**
- Create: `src/backup.ts`
- Create: `tests/backup.test.ts`

**Interfaces:**
- Consumes: `ExtensionState` and `ProviderId` from `src/types.ts`.
- Produces: `BackupFileV1`, `BackupErrorCode`, `BackupParseResult`, `ImportDataResult`, `MAX_BACKUP_BYTES`, `createBackup(state, exportedAt?)`, `parseBackupText(text)`, `parseBackupValue(value)`, and `backupErrorMessage(code)`.

- [ ] **Step 1: Write the failing backup tests**

Create `tests/backup.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  backupErrorMessage,
  createBackup,
  parseBackupText,
  parseBackupValue,
} from "../src/backup";
import { createInitialState } from "../src/state";
import type { ExtensionState } from "../src/types";

const EXPORTED_AT = "2026-07-19T12:00:00.000Z";

function populatedState(): ExtensionState {
  const state = createInitialState();
  state.lastRefreshAt = "2026-07-19T11:30:00.000Z";
  state.providers.claude.history = [{
    date: "2026-07-19",
    equivalentUsedUsd: 42,
    actualUsedUsd: 42,
    nativeUsed: 42,
  }];
  state.settings.syncMinutes = 30;
  return state;
}

describe("backup format", () => {
  it("creates and parses a version 1 full-state backup", () => {
    const state = populatedState();
    const backup = createBackup(state, EXPORTED_AT);

    expect(backup).toEqual({
      format: "slop-pacer-backup",
      formatVersion: 1,
      exportedAt: EXPORTED_AT,
      state,
    });
    expect(parseBackupText(JSON.stringify(backup))).toEqual({ ok: true, backup });
  });

  it("rejects malformed JSON", () => {
    expect(parseBackupText("{")).toEqual({ ok: false, error: "invalid_json" });
  });

  it("rejects a raw legacy state export", () => {
    expect(parseBackupValue(populatedState())).toEqual({ ok: false, error: "invalid_format" });
  });

  it("rejects an unsupported backup version", () => {
    const backup = { ...createBackup(populatedState(), EXPORTED_AT), formatVersion: 2 };

    expect(parseBackupValue(backup)).toEqual({ ok: false, error: "unsupported_version" });
  });

  it("rejects a backup with a missing provider", () => {
    const backup = structuredClone(createBackup(populatedState(), EXPORTED_AT));
    delete (backup.state.providers as Partial<ExtensionState["providers"]>).cursor;

    expect(parseBackupValue(backup)).toEqual({ ok: false, error: "invalid_data" });
  });

  it("rejects invalid settings", () => {
    const backup = structuredClone(createBackup(populatedState(), EXPORTED_AT));
    backup.state.settings.syncMinutes = 0;

    expect(parseBackupValue(backup)).toEqual({ ok: false, error: "invalid_data" });
  });

  it("rejects invalid dates", () => {
    const backup = structuredClone(createBackup(populatedState(), EXPORTED_AT));
    backup.state.providers.claude.history[0]!.date = "2026-99-99";

    expect(parseBackupValue(backup)).toEqual({ ok: false, error: "invalid_data" });
  });

  it("rejects non-finite numbers at the worker boundary", () => {
    const backup = structuredClone(createBackup(populatedState(), EXPORTED_AT));
    backup.state.providers.claude.budgetUsd = Number.POSITIVE_INFINITY;

    expect(parseBackupValue(backup)).toEqual({ ok: false, error: "invalid_data" });
  });

  it("maps every error code to concise popup copy", () => {
    expect(backupErrorMessage("invalid_format")).toBe("That file is not a Slop Pacer backup.");
    expect(backupErrorMessage("unsupported_version")).toBe("This backup version is not supported.");
    expect(backupErrorMessage("import_failed")).toBe("Slop Pacer could not restore that backup.");
  });
});
```

- [ ] **Step 2: Run the tests and verify the expected failure**

Run:

```bash
pnpm exec vitest run tests/backup.test.ts
```

Expected: FAIL because `../src/backup` does not exist.

- [ ] **Step 3: Implement the strict version 1 backup boundary**

Create `src/backup.ts`:

```ts
import { z } from "zod";
import type { ExtensionState, ProviderId } from "./types";

const BACKUP_FORMAT = "slop-pacer-backup";
const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 1024 * 1024;

const isoDate = z.iso.date();
const isoDateTime = z.iso.datetime({ offset: true });
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

const dailyUsageSchema = z.strictObject({
  date: isoDate,
  equivalentUsedUsd: finiteNumber,
  actualUsedUsd: finiteNumber.optional(),
  nativeUsed: finiteNumber.optional(),
});

function providerSnapshotSchema<const T extends ProviderId>(provider: T) {
  return z.strictObject({
    provider: z.literal(provider),
    capturedAt: isoDateTime,
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

function providerStateSchema<const T extends ProviderId>(provider: T) {
  return z.strictObject({
    id: z.literal(provider),
    status: connectionStatus,
    budgetUsd: nonNegativeNumber,
    snapshot: providerSnapshotSchema(provider).optional(),
    history: z.array(dailyUsageSchema),
    message: z.string().optional(),
    lastAttemptAt: isoDateTime.optional(),
    lastSuccessAt: isoDateTime.optional(),
  });
}

const extensionStateSchema = z.strictObject({
  schemaVersion: z.literal(3),
  providers: z.strictObject({
    claude: providerStateSchema("claude"),
    chatgpt: providerStateSchema("chatgpt"),
    cursor: providerStateSchema("cursor"),
  }),
  settings: z.strictObject({
    retentionMonths: z.number().int().min(1).max(24),
    syncMinutes: z.number().int().min(1).max(1440),
    allowScheduledCursorFocus: z.boolean(),
  }),
  lastRefreshAt: isoDateTime.optional(),
});

const backupFileV1Schema = z.strictObject({
  format: z.literal(BACKUP_FORMAT),
  formatVersion: z.literal(BACKUP_VERSION),
  exportedAt: isoDateTime,
  state: extensionStateSchema,
});

export type BackupFileV1 = z.infer<typeof backupFileV1Schema>;
export type BackupErrorCode =
  | "invalid_json"
  | "invalid_format"
  | "unsupported_version"
  | "invalid_data"
  | "import_failed";

export type BackupParseResult =
  | { ok: true; backup: BackupFileV1 }
  | { ok: false; error: BackupErrorCode };

export type ImportDataResult =
  | { ok: true; state: BackupFileV1["state"]; exportedAt: string }
  | { ok: false; error: BackupErrorCode };

function isRecord(value: unknown): value is Record<string, unknown> {
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

export function parseBackupValue(value: unknown): BackupParseResult {
  if (!isRecord(value) || value.format !== BACKUP_FORMAT) {
    return { ok: false, error: "invalid_format" };
  }
  if (value.formatVersion !== BACKUP_VERSION) {
    return { ok: false, error: "unsupported_version" };
  }
  const parsed = backupFileV1Schema.safeParse(value);
  return parsed.success
    ? { ok: true, backup: parsed.data }
    : { ok: false, error: "invalid_data" };
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
```

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```bash
pnpm exec vitest run tests/backup.test.ts
pnpm typecheck
```

Expected: both commands PASS.

- [ ] **Step 5: Commit the isolated backup format**

```bash
git add src/backup.ts tests/backup.test.ts
git commit -m "feat: add versioned backup format"
```

Expected: the commit contains only the two new files.

### Task 2: Validated State Replacement and Worker Orchestration

**Files:**
- Modify: `src/state.ts:1-48`
- Modify: `tests/state.test.ts:1-32`
- Modify: `src/types.ts:71-84`
- Modify: `src/background.ts:1-5, 96-115`

**Interfaces:**
- Consumes: `parseBackupValue(value: unknown)` and `createBackup(state)` from Task 1.
- Produces: `restoreBackup(value: unknown): Promise<ImportDataResult>` and the runtime request `{ type: "IMPORT_DATA"; backup: unknown }`.

- [ ] **Step 1: Add failing storage replacement tests**

Update the imports in `tests/state.test.ts` and append a restore test:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBackup } from "../src/backup";
import { createInitialState, restoreBackup, saveSettings } from "../src/state";
```

```ts
describe("backup restore", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("replaces the complete stored state after validation", async () => {
    let stored = createInitialState();
    stored.providers.claude.budgetUsd = 100;
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async () => ({ aiUsageMeterState: stored })),
          set: vi.fn(async ({ aiUsageMeterState }) => { stored = aiUsageMeterState; }),
        },
      },
    });
    const imported = createInitialState();
    imported.providers.claude.budgetUsd = 900;
    imported.providers.cursor.history = [{
      date: "2026-07-18",
      equivalentUsedUsd: 12,
      nativeUsed: 120,
    }];
    imported.settings.syncMinutes = 60;
    const exportedAt = "2026-07-19T12:00:00.000Z";

    const result = await restoreBackup(createBackup(imported, exportedAt));

    expect(result).toEqual({ ok: true, state: imported, exportedAt });
    expect(stored).toEqual(imported);
  });

  it("does not write an invalid backup", async () => {
    const set = vi.fn();
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async () => ({ aiUsageMeterState: createInitialState() })),
          set,
        },
      },
    });

    expect(await restoreBackup(createInitialState())).toEqual({
      ok: false,
      error: "invalid_format",
    });
    expect(set).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the state test and verify the expected failure**

Run:

```bash
pnpm exec vitest run tests/state.test.ts
```

Expected: FAIL because `restoreBackup` is not exported by `src/state.ts`.

- [ ] **Step 3: Add the testable restore operation**

Add top-level imports to `src/state.ts`:

```ts
import { parseBackupValue, type ImportDataResult } from "./backup";
```

Add after `saveState`:

```ts
export async function restoreBackup(value: unknown): Promise<ImportDataResult> {
  const parsed = parseBackupValue(value);
  if (!parsed.ok) return parsed;
  await saveState(parsed.backup.state);
  return {
    ok: true,
    state: parsed.backup.state,
    exportedAt: parsed.backup.exportedAt,
  };
}
```

- [ ] **Step 4: Extend the runtime protocol**

Add the import request to `ExtensionMessage` in `src/types.ts` immediately after `EXPORT_DATA`:

```ts
  | { type: "EXPORT_DATA" }
  | { type: "IMPORT_DATA"; backup: unknown }
  | { type: "RESET_HISTORY" };
```

- [ ] **Step 5: Orchestrate export and import in the background worker**

Update top-level imports and add the import lock in `src/background.ts`:

```ts
import { createBackup, type ImportDataResult } from "./backup";
import { collectProvider, normalizePageResult, type CollectionResult } from "./collectors";
import { providerUsageUrl } from "./providers";
import {
  createInitialState,
  getState,
  recordSnapshot,
  resetHistory,
  restoreBackup,
  saveSettings,
  saveState,
  updateProvider,
} from "./state";
```

Add beside `refreshPromise`:

```ts
let importPromise: Promise<ImportDataResult> | undefined;
```

At the start of `refreshAll`, wait for an active import before starting a refresh:

```ts
async function refreshAll(allowVisibleCursor = false): Promise<void> {
  if (importPromise) await importPromise;
```

Add this helper after `refreshScheduled`:

```ts
async function importData(backup: unknown): Promise<ImportDataResult> {
  await refreshPromise;
  if (importPromise) {
    await importPromise;
    return importData(backup);
  }
  importPromise = (async () => {
    const result = await restoreBackup(backup);
    if (result.ok) {
      await scheduleRefresh(result.state.settings.syncMinutes);
      await updateBadge();
    }
    return result;
  })().finally(() => {
    importPromise = undefined;
  });
  return importPromise;
}
```

The import lock closes both sides of the race: import waits for the current refresh,
and a newly triggered refresh waits until import finishes.

Replace the current export/reset tail of the message handler:

```ts
    else if (message.type === "PAGE_USAGE") { await acceptPageUsage(message); sendResponse({ ok: true }); }
    else if (message.type === "EXPORT_DATA") sendResponse(createBackup(await getState()));
    else if (message.type === "IMPORT_DATA") sendResponse(await importData(message.backup));
    else if (message.type === "RESET_HISTORY") sendResponse(await resetHistory());
  })().catch((error: unknown) => {
    if (message.type === "IMPORT_DATA") {
      const result: ImportDataResult = { ok: false, error: "import_failed" };
      sendResponse(result);
      return;
    }
    sendResponse({ error: error instanceof Error ? error.message : "Unexpected error" });
  });
```

Keep `return true;` and the rest of the listener unchanged.

- [ ] **Step 6: Run focused and full checks**

Run:

```bash
pnpm exec vitest run tests/state.test.ts tests/backup.test.ts
pnpm typecheck
pnpm test
```

Expected: all commands PASS.

- [ ] **Step 7: Commit worker-backed restore**

```bash
git add src/state.ts src/types.ts src/background.ts tests/state.test.ts
git commit -m "feat: restore validated backup state"
```

Expected: the commit excludes all pre-existing history-chart files.

### Task 3: Popup Import and Export Workflow

**Files:**
- Create: `tests/popup-backup-controls.test.ts`
- Modify: `popup.html:63-84`
- Modify: `src/popup.ts:1-15, 351-365`
- Modify: `src/styles.css:26-30, 223-227`

**Interfaces:**
- Consumes: Task 1's parser, error copy, size limit, and `ImportDataResult`; Task 2's `IMPORT_DATA` message.
- Produces: accessible popup controls, local file validation, replace-all confirmation, immediate rerender, and operation status.

- [ ] **Step 1: Write a failing popup markup contract**

Create `tests/popup-backup-controls.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("popup backup controls", () => {
  it("provides import, export, file input, and live status controls", async () => {
    const markup = await readFile(new URL("../popup.html", import.meta.url), "utf8");

    expect(markup).toContain('id="export"');
    expect(markup).toContain('id="import"');
    expect(markup).toContain('id="import-file"');
    expect(markup).toContain('accept=".json,application/json"');
    expect(markup).toContain('id="data-status"');
    expect(markup).toContain('aria-live="polite"');
  });
});
```

- [ ] **Step 2: Run the markup test and verify the expected failure**

Run:

```bash
pnpm exec vitest run tests/popup-backup-controls.test.ts
```

Expected: FAIL because `popup.html` has no import file input or data status output.

- [ ] **Step 3: Add accessible data controls**

Replace the current `.data-actions` block in `popup.html` with:

```html
        <div class="data-actions">
          <button id="export" type="button">Export JSON</button>
          <button id="import" type="button">Import JSON</button>
          <input id="import-file" class="visually-hidden" type="file" accept=".json,application/json" />
          <button id="reset" class="danger-button" type="button">Clear history</button>
        </div>
        <output id="data-status" aria-live="polite"></output>
```

- [ ] **Step 4: Add popup imports, element references, and helpers**

Add the backup import after the stylesheet import in `src/popup.ts`:

```ts
import "./styles.css";
import {
  MAX_BACKUP_BYTES,
  backupErrorMessage,
  parseBackupText,
  parseBackupValue,
  type ImportDataResult,
} from "./backup";
```

Add these references with the existing top-level element references:

```ts
const exportButton = document.querySelector<HTMLButtonElement>("#export")!;
const importButton = document.querySelector<HTMLButtonElement>("#import")!;
const importFile = document.querySelector<HTMLInputElement>("#import-file")!;
const resetButton = document.querySelector<HTMLButtonElement>("#reset")!;
const dataStatus = document.querySelector<HTMLOutputElement>("#data-status")!;
```

Add these helpers after `send`:

```ts
function setDataControlsDisabled(disabled: boolean): void {
  exportButton.disabled = disabled;
  importButton.disabled = disabled;
  resetButton.disabled = disabled;
}

function setDataStatus(message: string, isError = false): void {
  dataStatus.textContent = message;
  dataStatus.classList.toggle("error", isError);
}

function backupDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
```

- [ ] **Step 5: Replace export/reset listeners and add import handling**

Replace the listeners from the current `#export` listener through the current
`#reset` listener in `src/popup.ts`:

```ts
exportButton.addEventListener("click", async () => {
  setDataControlsDisabled(true);
  setDataStatus("");
  try {
    const response = await send<unknown>({ type: "EXPORT_DATA" });
    const parsed = parseBackupValue(response);
    if (!parsed.ok) throw new Error("Slop Pacer could not export a backup.");
    const backup = parsed.backup;
    const url = URL.createObjectURL(new Blob(
      [JSON.stringify(backup, null, 2)],
      { type: "application/json" },
    ));
    const link = document.createElement("a");
    link.href = url;
    link.download = `slop-pacer-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setDataStatus("Backup exported");
  } catch {
    setDataStatus("Slop Pacer could not export a backup.", true);
  } finally {
    setDataControlsDisabled(false);
  }
});

importButton.addEventListener("click", () => importFile.click());

importFile.addEventListener("change", () => {
  const file = importFile.files?.[0];
  if (!file) return;
  void (async () => {
    setDataControlsDisabled(true);
    setDataStatus("");
    try {
      if (file.size > MAX_BACKUP_BYTES) {
        throw new Error("The selected backup is larger than 1 MiB.");
      }
      const parsed = parseBackupText(await file.text());
      if (!parsed.ok) throw new Error(backupErrorMessage(parsed.error));
      const exportedOn = backupDate(parsed.backup.exportedAt);
      if (!confirm(
        `Import backup from ${exportedOn}?\n\nThis will replace all local Slop Pacer data.`,
      )) {
        setDataStatus("Import cancelled");
        return;
      }
      const result = await send<ImportDataResult>({
        type: "IMPORT_DATA",
        backup: parsed.backup,
      });
      if (!result.ok) throw new Error(backupErrorMessage(result.error));
      render(result.state);
      populateSettings();
      setDataStatus(`Imported backup from ${backupDate(result.exportedAt)}`);
    } catch (error: unknown) {
      setDataStatus(
        error instanceof Error ? error.message : "Slop Pacer could not restore that backup.",
        true,
      );
    } finally {
      importFile.value = "";
      setDataControlsDisabled(false);
    }
  })();
});

resetButton.addEventListener("click", async () => {
  if (!confirm("Clear all locally stored daily history? Current totals and settings will be kept.")) return;
  render(await send<ExtensionState>({ type: "RESET_HISTORY" }));
  setDataStatus("History cleared");
});
```

- [ ] **Step 6: Style the hidden input and operation status**

Add after the global `[hidden]` rule in `src/styles.css`:

```css
.visually-hidden {
  position: fixed;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
```

Extend the data-action styles:

```css
.data-actions { display: flex; justify-content: center; gap: 8px; padding: 0 18px 6px; }
.data-actions button { padding: 7px 10px; border: 1px solid var(--track-border); border-radius: 8px; background: var(--control); color: var(--blue); font-size: 13px; }
.data-actions button:disabled { cursor: default; opacity: 0.45; }
.data-actions .danger-button { color: var(--red-text); }
#data-status { display: block; min-height: 18px; padding: 0 18px 10px; color: var(--green-text); font-size: 12px; text-align: center; }
#data-status.error { color: var(--red-text); }
```

- [ ] **Step 7: Run popup checks**

Run:

```bash
pnpm exec vitest run tests/popup-backup-controls.test.ts tests/backup.test.ts
pnpm typecheck
pnpm build
```

Expected: all commands PASS and `dist/popup.html` contains the import controls.

- [ ] **Step 8: Preserve the user's dirty popup work**

Run:

```bash
git diff -- popup.html src/popup.ts src/styles.css
git status --short
```

Expected: the diff contains both the pre-existing history-chart work and the new
backup UI. Do not run `git add` on these shared files. Leave
`tests/popup-backup-controls.test.ts` uncommitted with its matching UI until the owner
decides how to commit the combined popup changes.

### Task 4: Documentation and End-to-End Verification

**Files:**
- Modify: `README.md:13-15, 30-38`
- Modify: `popup.html:101-103`

**Interfaces:**
- Consumes: the completed export/import behavior.
- Produces: accurate privacy and restore documentation plus final verification evidence.

- [ ] **Step 1: Update README feature and privacy copy**

Change the feature summary to:

```md
The extension includes rendered Usage-page collectors, local daily history,
session recovery, export/import/reset controls, and in-popup Overview, History,
Settings, and How It Works views.
```

Add this privacy bullet after the local-storage bullet:

```md
- Settings can export a versioned local backup or restore one. Restoring a backup
  replaces current Slop Pacer data after confirmation; backup contents are never
  uploaded.
```

- [ ] **Step 2: Update in-popup How It Works copy**

Replace the paragraph under **Stays local** in `popup.html`:

```html
            <p>Budgets, snapshots, and history remain in browser storage. Settings lets you export a local backup or restore one, replacing current Slop Pacer data after confirmation.</p>
```

- [ ] **Step 3: Run all automated verification**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Expected: every test passes, TypeScript reports no errors, and Vite produces `dist/`.

- [ ] **Step 4: Inspect the production package**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors. Existing history-chart files and shared popup/docs
files remain uncommitted, while Tasks 1 and 2 are committed.

- [ ] **Step 5: Manually verify the extension workflow**

Load `dist/` as an unpacked extension in Chrome or Edge 120+ and verify:

1. **Export JSON** downloads `slop-pacer-YYYY-MM-DD.json`.
2. The file contains `format`, `formatVersion`, `exportedAt`, and `state`.
3. Selecting a valid backup shows the replace-all confirmation.
4. Cancelling leaves data unchanged and reports `Import cancelled`.
5. Confirming immediately updates budgets, histories, settings fields, refresh
   scheduling, and badge state without opening provider pages.
6. Selecting the same file a second time works.
7. A raw legacy export, malformed JSON, wrong version, and file larger than 1 MiB
   each show the intended error and leave storage unchanged.
8. Export/import status is announced by the `aria-live` output.

- [ ] **Step 6: Report the intentional uncommitted boundary**

Do not commit `README.md`, `popup.html`, `src/popup.ts`, `src/styles.css`,
`tests/popup-backup-controls.test.ts`, `src/history-chart.ts`, or
`tests/history-chart.test.ts` without owner approval. Report these files together so
the owner can either commit the history chart first or authorize one combined UI
commit.
