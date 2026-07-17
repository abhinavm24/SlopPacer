import { describe, expect, it } from "vitest";
import { providerUsageUrl } from "../src/providers";

describe("provider usage URLs", () => {
  it("opens Cursor with a month-to-date range", () => {
    const now = new Date(2026, 6, 17, 12);
    expect(providerUsageUrl("cursor", now)).toBe("https://cursor.com/dashboard/usage?from=2026-07-01&to=2026-07-17");
  });

  it("preserves the other provider URLs", () => {
    expect(providerUsageUrl("claude")).toBe("https://claude.ai/new#settings/usage");
    expect(providerUsageUrl("chatgpt")).toBe("https://chatgpt.com/#settings/Usage");
  });
});
