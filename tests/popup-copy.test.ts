import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const popup = await readFile(new URL("../popup.html", import.meta.url), "utf8");

describe("concise popup copy", () => {
  it("omits the redundant summary caption", () => {
    expect(popup).not.toContain('id="summary-caption"');
    expect(popup).not.toContain("allowance = safe to spend today");
  });

  it("keeps four concise How It Works topics", () => {
    expect(popup).toContain("Uses signed-in usage pages");
    expect(popup).toContain("Combines provider spend");
    expect(popup).toContain("Today, workweek, and month");
    expect(popup).toContain("backup controls live in Settings");
  });

  it("labels the day, week, and month pace rings", () => {
    expect(popup).toContain('class="pace-ring-label pace-ring-label-day">D</span>');
    expect(popup).toContain('class="pace-ring-label pace-ring-label-week">W</span>');
    expect(popup).toContain('class="pace-ring-label pace-ring-label-month">M</span>');
  });
});
