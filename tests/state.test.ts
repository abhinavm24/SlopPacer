import { afterEach, describe, expect, it, vi } from "vitest";
import { createBackup } from "../src/backup";
import { createInitialState, restoreBackup, saveSettings } from "../src/state";

describe("extension settings", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps scheduled Cursor focus disabled by default", () => {
    expect(createInitialState().settings.allowScheduledCursorFocus).toBe(false);
  });

  it("persists the scheduled Cursor focus preference", async () => {
    let stored = createInitialState();
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async () => ({ aiUsageMeterState: stored })),
          set: vi.fn(async ({ aiUsageMeterState }) => { stored = aiUsageMeterState; }),
        },
      },
    });

    const state = await saveSettings(
      { claude: 2_000, chatgpt: 2_000, cursor: 2_000 },
      13,
      15,
      true,
    );

    expect(state.settings.allowScheduledCursorFocus).toBe(true);
    expect(stored.settings.allowScheduledCursorFocus).toBe(true);
  });
});

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
