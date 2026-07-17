import { describe, expect, it } from "vitest";
import { parseUsagePage } from "../src/page-parser";

describe("usage page parser", () => {
  it("parses Claude dollars", () => {
    expect(parseUsagePage("claude", "$897.60 of $2,000.00 spent", "https://claude.ai/new#settings/usage")).toMatchObject({
      kind: "usage", used: 897.6, limit: 2000, nativeUnit: "usd",
    });
  });

  it("parses ChatGPT credits", () => {
    expect(parseUsagePage("chatgpt", "2,648 / 28,500 credits", "https://chatgpt.com/#settings/Usage")).toMatchObject({
      kind: "usage", used: 2648, limit: 28500, nativeUnit: "credits",
    });
  });

  it("parses Cursor monthly usage", () => {
    expect(parseUsagePage("cursor", "Your monthly usage $57.06 / $2,000 Resets Aug 1, 2026", "https://cursor.com/dashboard/usage")).toMatchObject({
      kind: "usage", used: 57.06, limit: 2000, nativeUnit: "usd",
    });
  });

  it("recognizes a login page", () => {
    expect(parseUsagePage("cursor", "Sign in to Cursor", "https://cursor.com/login").kind).toBe("auth_required");
  });
});
