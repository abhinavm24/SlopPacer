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

  it("defaults only a corrupt setting while preserving exportable state", async () => {
    const stored = createInitialState();
    stored.providers.claude.budgetUsd = 875;
    stored.providers.claude.history = [{
      date: "2026-07-18",
      equivalentUsedUsd: 17,
      nativeUsed: 17,
    }];
    stored.settings.retentionMonths = 6;
    stored.settings.allowScheduledCursorFocus = true;
    stored.lastRefreshAt = "2026-07-19T11:30:00.000Z";
    const corrupt = structuredClone(stored) as unknown as {
      settings: { syncMinutes: unknown };
    };
    corrupt.settings.syncMinutes = "often";
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async () => ({ aiUsageMeterState: corrupt })),
        },
      },
    });

    const state = await getState();

    expect(state.providers.claude).toEqual(stored.providers.claude);
    expect(state.settings).toEqual({
      retentionMonths: 6,
      syncMinutes: createInitialState().settings.syncMinutes,
      allowScheduledCursorFocus: true,
    });
    expect(state.lastRefreshAt).toBe(stored.lastRefreshAt);
    expect(() => createBackup(state, "2026-07-19T12:00:00.000Z")).not.toThrow();
  });

  it("defaults a corrupt provider field and drops only invalid history entries", async () => {
    const stored = createInitialState();
    const validHistory = [
      { date: "2026-07-17", equivalentUsedUsd: 8, nativeUsed: 8 },
      { date: "2026-07-19", equivalentUsedUsd: 13, actualUsedUsd: 12 },
    ];
    stored.providers.claude = {
      id: "claude",
      status: "connected",
      budgetUsd: 950,
      snapshot: {
        provider: "claude",
        capturedAt: "2026-07-19T11:30:00.000Z",
        cycleStart: "2026-07-01",
        cycleEnd: "2026-07-31",
        nativeUnit: "usd",
        nativeUsed: 21,
        nativeLimit: 100,
        budgetUsd: 950,
        actualUsedUsd: 21,
        equivalentUsedUsd: 21,
        remainingUsd: 929,
        utilizationPercent: 2.21,
        source: "api",
      },
      history: validHistory,
      message: "Connected",
      lastAttemptAt: "2026-07-19T11:30:00.000Z",
      lastSuccessAt: "2026-07-19T11:30:00.000Z",
    };
    const corrupt = structuredClone(stored) as unknown as {
      providers: {
        claude: {
          status: unknown;
          history: unknown[];
        };
      };
    };
    corrupt.providers.claude.status = "mystery";
    corrupt.providers.claude.history.splice(
      1,
      0,
      { date: "not-a-date", equivalentUsedUsd: 999 },
      { date: "2026-07-18", equivalentUsedUsd: Number.POSITIVE_INFINITY },
    );
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async () => ({ aiUsageMeterState: corrupt })),
        },
      },
    });

    const state = await getState();

    expect(state.providers.claude.status).toBe("not_configured");
    expect(state.providers.claude.budgetUsd).toBe(950);
    expect(state.providers.claude.snapshot).toEqual(stored.providers.claude.snapshot);
    expect(state.providers.claude.history).toEqual(validHistory);
    expect(state.providers.claude.message).toBe("Connected");
    expect(state.providers.claude.lastSuccessAt).toBe("2026-07-19T11:30:00.000Z");
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
