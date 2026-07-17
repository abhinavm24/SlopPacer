import { describe, expect, it } from "vitest";
import {
  DEFAULT_SYNC_MINUTES,
  MAX_SYNC_MINUTES,
  MIN_SYNC_MINUTES,
  normalizeSyncMinutes,
} from "../src/sync";

describe("sync interval", () => {
  it("defaults invalid values to 15 minutes", () => {
    expect(normalizeSyncMinutes(undefined)).toBe(DEFAULT_SYNC_MINUTES);
    expect(normalizeSyncMinutes("not-a-number")).toBe(DEFAULT_SYNC_MINUTES);
  });

  it("rounds and clamps the configured interval", () => {
    expect(normalizeSyncMinutes(15.6)).toBe(16);
    expect(normalizeSyncMinutes(0)).toBe(MIN_SYNC_MINUTES);
    expect(normalizeSyncMinutes(2000)).toBe(MAX_SYNC_MINUTES);
  });
});
