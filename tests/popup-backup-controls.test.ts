import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("popup backup controls", () => {
  it("provides import, export, file input, and live status controls", async () => {
    const markup = await readFile(new URL("../popup.html", import.meta.url), "utf8");

    expect(markup).toContain('id="export"');
    expect(markup).toContain('id="import"');
    expect(markup).toContain('id="import-file"');
    expect(markup).toContain('accept=".json,application/json"');
    expect(markup).toContain('<output id="data-status" aria-live="polite"></output>');
  });
});
