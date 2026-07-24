import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const popup = await readFile(new URL("../popup.html", import.meta.url), "utf8");

describe("concise popup copy", () => {
  it("omits the redundant summary caption", () => {
    expect(popup).not.toContain('id="summary-caption"');
    expect(popup).not.toContain("allowance = safe to spend today");
  });

  it("keeps four How It Works topics with collection and privacy details", () => {
    expect(popup.match(/<section>\s*<h2>/g)).toHaveLength(4);
    expect(popup).toContain("Reads your month-to-date usage");
    expect(popup).toContain("It reuses an open Usage tab or briefly opens and closes one");
    expect(popup).toContain("Cursor is shown for a moment");
    expect(popup).toContain("Combines provider spend");
    expect(popup).toContain("Today, workweek, and month");
    expect(popup).toContain("cookies, tokens, and raw responses are never saved");
    expect(popup).toContain("Settings can export or restore a local backup");
    expect(popup).toContain("replacing current data after confirmation");
  });

  it("labels the day, week, and month pace rings", () => {
    expect(popup).toContain('class="pace-ring-label pace-ring-label-day">D</span>');
    expect(popup).toContain('class="pace-ring-label pace-ring-label-week">W</span>');
    expect(popup).toContain('class="pace-ring-label pace-ring-label-month">M</span>');
  });
});
