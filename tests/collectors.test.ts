import { afterEach, describe, expect, it, vi } from "vitest";
import { collectProvider } from "../src/collectors";

describe("page collectors", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("allows a slow Cursor usage page more than 30 seconds to render", async () => {
    vi.useFakeTimers();
    let scrapeCount = 0;
    const remove = vi.fn().mockResolvedValue(undefined);
    const update = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("chrome", {
      tabs: {
        query: vi.fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ id: 7 }]),
        create: vi.fn().mockResolvedValue({ id: 42 }),
        sendMessage: vi.fn().mockImplementation(async () => {
          scrapeCount += 1;
          return scrapeCount >= 62
            ? { provider: "cursor", kind: "usage", used: 58, limit: 2_000, nativeUnit: "usd" }
            : { provider: "cursor", kind: "unavailable" };
        }),
        remove,
        update,
      },
    });

    const resultPromise = collectProvider("cursor", 2_000, true);
    await vi.advanceTimersByTimeAsync(31_000);

    await expect(resultPromise).resolves.toMatchObject({
      kind: "success",
      snapshot: { provider: "cursor", nativeUsed: 58 },
    });
    expect(remove).toHaveBeenCalledWith(42);
    expect(update).toHaveBeenCalledWith(7, { active: true });
  });

  it("opens Cursor visibly so its dashboard fetches usage data", async () => {
    const create = vi.fn().mockResolvedValue({ id: 42 });
    vi.stubGlobal("chrome", {
      tabs: {
        query: vi.fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ id: 7 }]),
        create,
        sendMessage: vi.fn().mockResolvedValue({
          provider: "cursor", kind: "usage", used: 59, limit: 2_000, nativeUnit: "usd",
        }),
        remove: vi.fn().mockResolvedValue(undefined),
        update: vi.fn().mockResolvedValue(undefined),
      },
    });

    await expect(collectProvider("cursor", 2_000, true)).resolves.toMatchObject({ kind: "success" });
    expect(create).toHaveBeenCalledWith({
      url: expect.stringContaining("cursor.com/dashboard/usage"),
      active: true,
    });
  });

  it("does not take focus during a scheduled refresh", async () => {
    const create = vi.fn().mockResolvedValue({ id: 42 });
    const update = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("chrome", {
      tabs: {
        query: vi.fn().mockResolvedValue([]),
        create,
        sendMessage: vi.fn().mockResolvedValue({
          provider: "cursor", kind: "usage", used: 59, limit: 2_000, nativeUnit: "usd",
        }),
        remove: vi.fn().mockResolvedValue(undefined),
        update,
      },
    });

    await collectProvider("cursor", 2_000);
    expect(create).toHaveBeenCalledWith({
      url: expect.stringContaining("cursor.com/dashboard/usage"),
      active: false,
    });
    expect(update).not.toHaveBeenCalled();
  });
});
