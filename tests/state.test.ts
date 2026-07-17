import { afterEach, describe, expect, it, vi } from "vitest";
import { createInitialState, saveSettings } from "../src/state";

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
