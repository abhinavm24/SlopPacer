# Concise Popup Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove redundant Home explanation and fit concise How It Works guidance within the popup without scrolling.

**Architecture:** Keep the existing popup structure and calculations. Make copy-only DOM changes in `popup.html`, remove the obsolete caption rendering hook from `src/popup.ts`, and tighten the existing How It Works card styles in `src/styles.css`.

**Tech Stack:** HTML, TypeScript, CSS, Vitest, Vite

## Global Constraints

- Keep the popup at 410×596px with a 538px content view.
- Preserve all usage calculations, navigation, light/dark themes, focus styles, and reduced-motion behavior.
- Keep four How It Works topics and the green/amber/red pace key.

---

### Task 1: Remove redundant Home caption and shorten guidance

**Files:**
- Create: `tests/popup-copy.test.ts`
- Modify: `popup.html`
- Modify: `src/popup.ts`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: Existing `renderSummary(summary: SummaryBreakdown | undefined): void`.
- Produces: Popup markup without `#summary-caption`; four one-sentence How It Works cards.

- [ ] **Step 1: Write the failing DOM test**

Create `tests/popup-copy.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `./node_modules/.bin/vitest run tests/popup-copy.test.ts`

Expected: both tests fail because the caption and verbose copy are still present.

- [ ] **Step 3: Implement the concise markup and cleanup**

In `popup.html`, remove the `#summary-caption` paragraph and replace the four How It Works paragraphs with:

```html
<p>Uses signed-in usage pages—no API keys; Cursor may briefly appear during refresh.</p>
<p>Combines provider spend against monthly budgets; Cursor credits convert to dollars.</p>
<p>Today, workweek, and month show spend against pace, projection, and budget left.</p>
<p>Budgets and history stay in browser storage; backup controls live in Settings.</p>
```

Rename the third heading to `Shows your pace`.

In `src/popup.ts`, remove the `#summary-caption` query and both `caption.hidden` assignments.

In `src/styles.css`, remove `.summary-caption`. Set `#howto-view { overflow: hidden; }`, reduce `.howto-content` gap to `8px`, and reduce card padding to `11px 13px`.

- [ ] **Step 4: Run focused tests**

Run: `./node_modules/.bin/vitest run tests/popup-copy.test.ts tests/popup-backup-behavior.test.ts`

Expected: all focused tests pass.

### Task 2: Verify fit and ship

**Files:**
- Modify only if visual verification reveals clipping: `src/styles.css`

**Interfaces:**
- Consumes: Built `dist/popup.html`.
- Produces: A no-scroll How It Works view at 410×596px.

- [ ] **Step 1: Run automated verification**

Run:

```bash
./node_modules/.bin/vitest run
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/vite build
```

Expected: 17 test files pass, typecheck exits 0, and Vite creates `dist/`.

- [ ] **Step 2: Verify rendered height**

Render the built popup at 410×596px in light and dark modes. Open How It Works and confirm:

```js
document.querySelector("#howto-view").scrollHeight <=
  document.querySelector("#howto-view").clientHeight
```

Expected: `true` in both themes, with all four cards and the pace key visible.

- [ ] **Step 3: Commit and open the PR**

Commit the focused implementation, push `feat/concise-popup-copy`, and open a PR with the test and visual verification results.
