import { afterEach, describe, expect, it, vi } from "vitest";
import { createBackup } from "../src/backup";
import { createInitialState, getState, restoreBackup, saveSettings } from "../src/state";

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

  it("falls back to an exportable initial state when migrated storage is corrupt", async () => {
    const corrupt = createInitialState() as unknown as Record<string, unknown>;
    corrupt.settings = {
      retentionMonths: 13,
      syncMinutes: "often",
      allowScheduledCursorFocus: false,
    };
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async () => ({ aiUsageMeterState: corrupt })),
        },
      },
    });

    const state = await getState();

    expect(state).toEqual(createInitialState());
    expect(() => createBackup(state, "2026-07-19T12:00:00.000Z")).not.toThrow();
  });

  it("preserves valid prior state while filling current defaults", async () => {
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async () => ({
            aiUsageMeterState: {
              schemaVersion: 2,
              providers: {
                claude: {
                  id: "claude",
                  status: "connected",
                  budgetUsd: 750,
                  history: [],
                },
              },
              settings: { retentionMonths: 6, syncMinutes: 60 },
            },
          })),
        },
      },
    });

    const state = await getState();

    expect(state.providers.claude.budgetUsd).toBe(750);
    expect(state.providers.cursor.status).toBe("not_configured");
    expect(state.settings).toEqual({
      retentionMonths: 6,
      syncMinutes: 60,
      allowScheduledCursorFocus: false,
    });
    expect(() => createBackup(state, "2026-07-19T12:00:00.000Z")).not.toThrow();
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
