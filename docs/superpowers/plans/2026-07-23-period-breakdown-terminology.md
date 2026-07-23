# Period Breakdown & Pace Terminology Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace SlopPacer's combined-summary UI with a Today / Week / Month breakdown using the reference widget's `allowance` / `proj` / `left` terminology, computed from existing web-console snapshots and daily history (no data-fetching changes).

**Architecture:** Add a pure `src/periods.ts` that turns the three providers' `history[]` deltas plus the combined month-to-date total into a `SummaryBreakdown` (reusing the existing pure `calculatePacing`). Extend `pacing.ts` with an all-days allowance and drop the now-unused `paceStatus`. Rewrite the combined summary in `popup.html` / `popup.ts` / `styles.css` and recolor every bar with a shared fill-status model (green/amber/red).

**Tech Stack:** TypeScript, Vite, Vitest (+ jsdom for popup DOM tests), pnpm. Chrome/Edge MV3 extension. No new dependencies.

## Global Constraints

- Node.js >= 22, pnpm 11 (`packageManager: pnpm@11.9.0`).
- No new runtime dependencies; only `zod` is a dependency.
- **No changes to data collection.** Do not touch `collectors.ts`, `content.ts`, `page-parser.ts`, `background.ts`, or host permissions. All new values derive from existing `ProviderState.snapshot` and `ProviderState.history`.
- Money is formatted with the existing `money()` helper (whole dollars, `maximumFractionDigits: 0`).
- Dates are UTC `YYYY-MM-DD` strings, matching `pacing.ts` and `recordSnapshot`.
- Fill-status thresholds: `green` if `spent/target < 0.8`, `amber` if `< 1.0`, else `red`; `target <= 0` → `red`.
- Verification commands (run from repo root): `pnpm test`, `pnpm typecheck`, `pnpm build`.
- Exhaustive `switch` over unions/enums must use a `never` default (workspace rule). Imports stay at the top of the module (workspace rule).

---

### Task 1: `pacing.ts` — add all-days allowance, remove `paceStatus`

**Files:**
- Modify: `src/pacing.ts`
- Test: `tests/pacing.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `interface PacingMetrics` now has `requiredPerRemainingDayAllDays: number` and **no** `paceStatus`.
  - `export function countWorkingDays(start: string, end: string): number` (unchanged).
  - `export function countCalendarDays(start: string, end: string): number` (new).
  - `export function calculatePacing(used: number, budget: number, cycleStart: string, cycleEnd: string, now?: Date): PacingMetrics`.

- [ ] **Step 1: Update the failing tests**

Replace the entire contents of `tests/pacing.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { calculatePacing, countCalendarDays, countWorkingDays } from "../src/pacing";

describe("working-day pacing", () => {
  it("counts weekdays inclusively", () => {
    expect(countWorkingDays("2026-07-01", "2026-07-31")).toBe(23);
    expect(countWorkingDays("2026-07-18", "2026-07-19")).toBe(0);
  });

  it("counts calendar days inclusively", () => {
    expect(countCalendarDays("2026-07-17", "2026-07-31")).toBe(15);
    expect(countCalendarDays("2026-07-31", "2026-07-01")).toBe(0);
  });

  it("includes today in elapsed and remaining working days", () => {
    const pacing = calculatePacing(1000, 2000, "2026-07-01", "2026-07-31", new Date("2026-07-17T07:00:00Z"));
    expect(pacing.elapsedWorkingDays).toBe(13);
    expect(pacing.remainingWorkingDays).toBe(11);
    expect(pacing.requiredPerRemainingDay).toBeCloseTo(90.91);
  });

  it("spreads the remaining budget over remaining calendar days", () => {
    const pacing = calculatePacing(1000, 2000, "2026-07-01", "2026-07-31", new Date("2026-07-17T07:00:00Z"));
    expect(pacing.requiredPerRemainingDayAllDays).toBeCloseTo(66.67);
  });

  it("derives per-day averages and available spend", () => {
    const pacing = calculatePacing(500, 2000, "2026-07-01", "2026-07-31", new Date("2026-07-17T07:00:00Z"));
    expect(pacing.averagePerElapsedDay).toBeCloseTo(38.46);
    expect(pacing.requiredPerRemainingDay).toBeCloseTo(136.36);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/pacing.test.ts`
Expected: FAIL — `countCalendarDays` is not exported and `requiredPerRemainingDayAllDays` is undefined.

- [ ] **Step 3: Implement the changes**

Replace the entire contents of `src/pacing.ts` with:

```ts
export interface PacingMetrics {
  totalWorkingDays: number;
  elapsedWorkingDays: number;
  remainingWorkingDays: number;
  averagePerElapsedDay: number;
  targetPerWorkingDay: number;
  requiredPerRemainingDay: number;
  requiredPerRemainingDayAllDays: number;
  remainingPercent: number;
}

function parseDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T12:00:00Z`);
}

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function countWorkingDays(start: string, end: string): number {
  const cursor = parseDate(start);
  const last = parseDate(end);
  let count = 0;
  while (cursor <= last) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

export function countCalendarDays(start: string, end: string): number {
  const first = parseDate(start);
  const last = parseDate(end);
  if (first > last) return 0;
  return Math.round((last.getTime() - first.getTime()) / 86_400_000) + 1;
}

export function calculatePacing(
  used: number,
  budget: number,
  cycleStart: string,
  cycleEnd: string,
  now = new Date(),
): PacingMetrics {
  const today = dateKey(now);
  const elapsedEnd = today < cycleStart ? cycleStart : today > cycleEnd ? cycleEnd : today;
  const remainingStart = today < cycleStart ? cycleStart : today;
  const totalWorkingDays = countWorkingDays(cycleStart, cycleEnd);
  const elapsedWorkingDays = today < cycleStart ? 0 : countWorkingDays(cycleStart, elapsedEnd);
  const remainingWorkingDays = today > cycleEnd ? 0 : countWorkingDays(remainingStart, cycleEnd);
  const remainingCalendarDays = today > cycleEnd ? 0 : countCalendarDays(remainingStart, cycleEnd);
  const safeUsed = Math.max(0, used);
  const safeBudget = Math.max(0, budget);
  const remaining = Math.max(0, safeBudget - safeUsed);
  const targetPerWorkingDay = totalWorkingDays ? safeBudget / totalWorkingDays : 0;
  const averagePerElapsedDay = elapsedWorkingDays ? safeUsed / elapsedWorkingDays : 0;
  const requiredPerRemainingDay = remainingWorkingDays ? remaining / remainingWorkingDays : remaining;
  const requiredPerRemainingDayAllDays = remainingCalendarDays ? remaining / remainingCalendarDays : remaining;

  return {
    totalWorkingDays,
    elapsedWorkingDays,
    remainingWorkingDays,
    averagePerElapsedDay,
    targetPerWorkingDay,
    requiredPerRemainingDay,
    requiredPerRemainingDayAllDays,
    remainingPercent: safeBudget ? (remaining / safeBudget) * 100 : 0,
  };
}
```

- [ ] **Step 4: Run tests + typecheck to verify they pass**

Run: `pnpm exec vitest run tests/pacing.test.ts && pnpm typecheck`
Expected: pacing tests PASS. `typecheck` will FAIL in `src/popup.ts` (`paceStatus` / `paceClass` still referenced) — that is expected and fixed in Task 3. Confirm the only type errors are in `src/popup.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/pacing.ts tests/pacing.test.ts
git commit -m "feat(pacing): add all-days allowance, drop paceStatus"
```

---

### Task 2: `src/periods.ts` — pure period math

**Files:**
- Create: `src/periods.ts`
- Test: `tests/periods.test.ts`

**Interfaces:**
- Consumes: `calculatePacing`, `countWorkingDays` from `./pacing`; `DailyUsage` from `./types`.
- Produces:
  - `type FillStatus = "green" | "amber" | "red"`.
  - `interface SummaryBreakdown { todaySpent, weekSpent, monthSpent, todayAllowance, todayAllowanceAllDays, weekTarget, monthBudget, projectedMonth, left, remainingWorkingDays }` (all `number`).
  - `function isoWorkweek(now: Date): { start: string; end: string }`.
  - `function sumForDate(history: DailyUsage[], date: string): number`.
  - `function sumRange(history: DailyUsage[], start: string, end: string): number`.
  - `function fillStatus(spent: number, target: number): FillStatus`.
  - `function computeSummary(histories: DailyUsage[][], monthSpent: number, combinedBudget: number, cycleStart: string, cycleEnd: string, now?: Date): SummaryBreakdown`.

- [ ] **Step 1: Write the failing test**

Create `tests/periods.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeSummary, fillStatus, isoWorkweek, sumForDate, sumRange } from "../src/periods";
import type { DailyUsage } from "../src/types";

const claude: DailyUsage[] = [
  { date: "2026-07-13", equivalentUsedUsd: 10 }, // Mon
  { date: "2026-07-16", equivalentUsedUsd: 20 }, // Thu
  { date: "2026-07-17", equivalentUsedUsd: 30 }, // Fri (today)
  { date: "2026-07-18", equivalentUsedUsd: 5 },  // Sat (outside the workweek)
];
const chatgpt: DailyUsage[] = [{ date: "2026-07-17", equivalentUsedUsd: 7 }];
const now = new Date("2026-07-17T07:00:00Z"); // Friday

describe("period helpers", () => {
  it("returns Monday..Friday of the current ISO week", () => {
    expect(isoWorkweek(now)).toEqual({ start: "2026-07-13", end: "2026-07-17" });
  });

  it("maps Saturday and Sunday back to the same work week", () => {
    expect(isoWorkweek(new Date("2026-07-18T07:00:00Z")).start).toBe("2026-07-13");
    expect(isoWorkweek(new Date("2026-07-19T07:00:00Z")).start).toBe("2026-07-13");
  });

  it("sums a single day and an inclusive range", () => {
    expect(sumForDate(claude, "2026-07-17")).toBe(30);
    expect(sumRange(claude, "2026-07-13", "2026-07-17")).toBe(60);
    expect(sumRange(claude, "2026-07-20", "2026-07-13")).toBe(0);
  });

  it("colors by fill ratio with 80% and 100% thresholds", () => {
    expect(fillStatus(79, 100)).toBe("green");
    expect(fillStatus(80, 100)).toBe("amber");
    expect(fillStatus(99, 100)).toBe("amber");
    expect(fillStatus(100, 100)).toBe("red");
    expect(fillStatus(10, 0)).toBe("red");
  });
});

describe("computeSummary", () => {
  it("breaks combined spend into today, week, and month", () => {
    const summary = computeSummary([claude, chatgpt], 1000, 2000, "2026-07-01", "2026-07-31", now);
    expect(summary.todaySpent).toBe(37);   // 30 + 7
    expect(summary.weekSpent).toBe(67);    // Mon..Fri 10+20+30 + 7; Sat 5 excluded
    expect(summary.monthSpent).toBe(1000);
    expect(summary.monthBudget).toBe(2000);
    expect(summary.left).toBe(1000);
    expect(summary.remainingWorkingDays).toBe(11);
  });

  it("uses workday allowance for today and a pace-based weekly target", () => {
    const summary = computeSummary([claude, chatgpt], 1000, 2000, "2026-07-01", "2026-07-31", now);
    expect(summary.todayAllowance).toBeCloseTo(90.91);        // 1000 / 11 workdays
    expect(summary.todayAllowanceAllDays).toBeCloseTo(66.67); // 1000 / 15 calendar days
    expect(summary.weekTarget).toBeCloseTo((2000 / 23) * 5);  // targetPerWorkingDay * 5 workdays
  });

  it("projects month-end on a workday pace", () => {
    const summary = computeSummary([claude, chatgpt], 1000, 2000, "2026-07-01", "2026-07-31", now);
    expect(summary.projectedMonth).toBeCloseTo((1000 / 13) * 23);
  });

  it("clamps the week to the start of the cycle at a month boundary", () => {
    const history: DailyUsage[] = [
      { date: "2026-07-13", equivalentUsedUsd: 100 }, // before cycleStart
      { date: "2026-07-15", equivalentUsedUsd: 40 },  // Wed, in cycle
      { date: "2026-07-17", equivalentUsedUsd: 25 },  // Fri, in cycle
    ];
    const summary = computeSummary([history], 65, 1000, "2026-07-15", "2026-07-31", now);
    expect(summary.weekSpent).toBe(65); // excludes the 100 before cycleStart
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/periods.test.ts`
Expected: FAIL — cannot find module `../src/periods`.

- [ ] **Step 3: Write the implementation**

Create `src/periods.ts`:

```ts
import { calculatePacing, countWorkingDays } from "./pacing";
import type { DailyUsage } from "./types";

export type FillStatus = "green" | "amber" | "red";

export interface SummaryBreakdown {
  todaySpent: number;
  weekSpent: number;
  monthSpent: number;
  todayAllowance: number;
  todayAllowanceAllDays: number;
  weekTarget: number;
  monthBudget: number;
  projectedMonth: number;
  left: number;
  remainingWorkingDays: number;
}

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function isoWorkweek(now: Date): { start: string; end: string } {
  const day = now.getUTCDay(); // 0 Sun .. 6 Sat
  const offsetToMonday = day === 0 ? -6 : 1 - day; // Sunday belongs to the preceding work week
  const monday = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + offsetToMonday,
    12,
  ));
  const friday = new Date(monday.getTime());
  friday.setUTCDate(monday.getUTCDate() + 4);
  return { start: dateKey(monday), end: dateKey(friday) };
}

export function sumForDate(history: DailyUsage[], date: string): number {
  return history.reduce(
    (sum, item) => (item.date === date ? sum + item.equivalentUsedUsd : sum),
    0,
  );
}

export function sumRange(history: DailyUsage[], start: string, end: string): number {
  if (start > end) return 0;
  return history.reduce(
    (sum, item) => (item.date >= start && item.date <= end ? sum + item.equivalentUsedUsd : sum),
    0,
  );
}

export function fillStatus(spent: number, target: number): FillStatus {
  if (target <= 0) return "red";
  const ratio = spent / target;
  if (ratio < 0.8) return "green";
  if (ratio < 1) return "amber";
  return "red";
}

export function computeSummary(
  histories: DailyUsage[][],
  monthSpent: number,
  combinedBudget: number,
  cycleStart: string,
  cycleEnd: string,
  now = new Date(),
): SummaryBreakdown {
  const pacing = calculatePacing(monthSpent, combinedBudget, cycleStart, cycleEnd, now);
  const today = dateKey(now);
  const week = isoWorkweek(now);
  const weekStart = week.start < cycleStart ? cycleStart : week.start;
  const weekEnd = week.end > cycleEnd ? cycleEnd : week.end;
  const weekdaysInRange = countWorkingDays(weekStart, weekEnd);

  const todaySpent = histories.reduce((sum, history) => sum + sumForDate(history, today), 0);
  const weekSpent = histories.reduce((sum, history) => sum + sumRange(history, weekStart, weekEnd), 0);

  return {
    todaySpent,
    weekSpent,
    monthSpent,
    todayAllowance: pacing.requiredPerRemainingDay,
    todayAllowanceAllDays: pacing.requiredPerRemainingDayAllDays,
    weekTarget: pacing.targetPerWorkingDay * weekdaysInRange,
    monthBudget: combinedBudget,
    projectedMonth: pacing.averagePerElapsedDay * pacing.totalWorkingDays,
    left: Math.max(0, combinedBudget - monthSpent),
    remainingWorkingDays: pacing.remainingWorkingDays,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/periods.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/periods.ts tests/periods.test.ts
git commit -m "feat(periods): pure today/week/month summary math"
```

---

### Task 3: Combined summary UI + fill-status coloring

**Files:**
- Modify: `popup.html` (combined summary markup + how-it-works copy — copy handled in Task 4; markup here)
- Modify: `src/popup.ts`
- Modify: `src/styles.css`
- Test: `tests/popup-backup-behavior.test.ts`

**Interfaces:**
- Consumes: `computeSummary`, `fillStatus`, `type SummaryBreakdown` from `./periods`; `calculatePacing`, `type PacingMetrics` from `./pacing` (for provider rows).
- Produces: new summary DOM ids `#combined-today`, `#summary-allowance`, `#today-fill`/`#today-label`, `#week-fill`/`#week-label`, `#month-fill`/`#month-label`, `#summary-foot` (plus existing `#summary-days`). CSS classes `.fill-green/.fill-amber/.fill-red` (bar fills) and `.text-green/.text-amber/.text-red` (label text). Tokens `--amber` / `--amber-text`.

- [ ] **Step 1: Replace the combined summary markup**

In `popup.html`, replace this block:

```html
        <section class="summary" aria-label="Combined budget">
          <div class="summary-top">
            <div><strong id="combined-used">—</strong><span id="combined-limit">of —</span></div>
            <span id="summary-days" class="summary-days">Current month</span>
          </div>
          <div class="summary-metrics">
            <span id="combined-remaining" class="summary-remaining">No usage yet</span>
            <span id="summary-pacing" class="summary-pacing">No pacing yet</span>
          </div>
          <div class="usage-bar summary-bar" role="progressbar" aria-label="Combined budget used"><span id="combined-bar"></span></div>
        </section>
```

with:

```html
        <section class="summary" aria-label="Combined budget">
          <div class="summary-top">
            <strong id="combined-today">—</strong>
            <span id="summary-days" class="summary-days">Current month</span>
          </div>
          <div id="summary-allowance" class="summary-allowance">No usage yet</div>
          <div class="period-bars">
            <div class="period">
              <div class="period-head"><span>Today</span><span id="today-label" class="period-value"></span></div>
              <div class="usage-bar period-bar" role="progressbar" aria-label="Today versus allowance"><span id="today-fill"></span></div>
            </div>
            <div class="period">
              <div class="period-head"><span>Week</span><span id="week-label" class="period-value"></span></div>
              <div class="usage-bar period-bar" role="progressbar" aria-label="This week versus weekly pace"><span id="week-fill"></span></div>
            </div>
            <div class="period">
              <div class="period-head"><span>Month</span><span id="month-label" class="period-value"></span></div>
              <div class="usage-bar period-bar" role="progressbar" aria-label="This month versus budget"><span id="month-fill"></span></div>
            </div>
          </div>
          <div id="summary-foot" class="summary-foot"></div>
        </section>
```

- [ ] **Step 2: Update `src/popup.ts` imports and helpers**

Replace the import line:

```ts
import { calculatePacing, type PacingMetrics } from "./pacing";
```

with:

```ts
import { calculatePacing, type PacingMetrics } from "./pacing";
import { computeSummary, fillStatus, type SummaryBreakdown } from "./periods";
```

Then replace these three helpers:

```ts
function pacingText(pacing: PacingMetrics): string {
  return `Avg ${money(pacing.averagePerElapsedDay)}/day · Available ${money(pacing.requiredPerRemainingDay)}/day`;
}

function paceClass(pacing: PacingMetrics): string {
  return `pace-${pacing.paceStatus.replace("_", "-")}`;
}

function setBar(bar: HTMLElement, usedPercent: number, pacing: PacingMetrics): void {
  const value = Math.max(0, Math.min(100, usedPercent));
  bar.style.width = `${value}%`;
  bar.className = paceClass(pacing);
  bar.parentElement?.setAttribute("aria-valuenow", String(Math.round(value)));
}
```

with:

```ts
function pacingText(pacing: PacingMetrics): string {
  return `Avg ${money(pacing.averagePerElapsedDay)}/day · Available ${money(pacing.requiredPerRemainingDay)}/day`;
}

function setFill(fill: HTMLElement, spent: number, target: number): void {
  const value = target <= 0 ? (spent > 0 ? 100 : 0) : Math.max(0, Math.min(100, (spent / target) * 100));
  fill.style.width = `${value}%`;
  fill.className = `fill-${fillStatus(spent, target)}`;
  fill.parentElement?.setAttribute("aria-valuenow", String(Math.round(value)));
}

function setPeriodBar(fillId: string, labelId: string, spent: number, target: number): void {
  setFill(document.querySelector<HTMLElement>(`#${fillId}`)!, spent, target);
  document.querySelector(`#${labelId}`)!.textContent = `${money(spent)} / ${money(target)}`;
}

function renderSummary(summary: SummaryBreakdown | undefined): void {
  const today = document.querySelector<HTMLElement>("#combined-today")!;
  const days = document.querySelector<HTMLElement>("#summary-days")!;
  const allowance = document.querySelector<HTMLElement>("#summary-allowance")!;
  const foot = document.querySelector<HTMLElement>("#summary-foot")!;
  if (!summary) {
    today.textContent = "—";
    days.textContent = "Current month";
    allowance.textContent = "No usage yet";
    foot.textContent = "";
    for (const [fillId, labelId] of [
      ["today-fill", "today-label"],
      ["week-fill", "week-label"],
      ["month-fill", "month-label"],
    ] as const) {
      const fill = document.querySelector<HTMLElement>(`#${fillId}`)!;
      fill.style.width = "0%";
      fill.className = "";
      document.querySelector(`#${labelId}`)!.textContent = "";
    }
    return;
  }
  today.textContent = money(summary.todaySpent);
  days.textContent = `${summary.remainingWorkingDays} days left`;
  allowance.textContent =
    `today · allowance ${money(summary.todayAllowance)} (${money(summary.todayAllowanceAllDays)})`;
  setPeriodBar("today-fill", "today-label", summary.todaySpent, summary.todayAllowance);
  setPeriodBar("week-fill", "week-label", summary.weekSpent, summary.weekTarget);
  setPeriodBar("month-fill", "month-label", summary.monthSpent, summary.monthBudget);
  foot.textContent = `proj ${money(summary.projectedMonth)} · left ${money(summary.left)}`;
}
```

- [ ] **Step 3: Rewrite the summary section of `render()` in `src/popup.ts`**

Replace this block (start of `render`, from `currentState = state;` through the `#summary-pacing` assignment):

```ts
  currentState = state;
  const snapshots = PROVIDER_IDS.flatMap((id) => state.providers[id].snapshot ? [state.providers[id].snapshot!] : []);
  const combined = combineSnapshots(snapshots);
  const combinedBudget = PROVIDER_IDS.reduce((sum, id) => sum + state.providers[id].budgetUsd, 0);
  const combinedRemaining = Math.max(0, combinedBudget - combined.usedUsd);
  const combinedRemainingPercent = combinedBudget ? (combinedRemaining / combinedBudget) * 100 : 0;
  const cycle = snapshots[0];
  const combinedPacing = cycle
    ? calculatePacing(combined.usedUsd, combinedBudget, cycle.cycleStart, cycle.cycleEnd)
    : undefined;

  document.querySelector("#combined-used")!.textContent = snapshots.length ? money(combined.usedUsd) : "—";
  document.querySelector("#combined-limit")!.textContent = `of ${money(combinedBudget)}`;
  document.querySelector("#summary-days")!.textContent = combinedPacing
    ? `${combinedPacing.remainingWorkingDays} days left`
    : "Current month";
  const remaining = document.querySelector<HTMLElement>("#combined-remaining")!;
  remaining.textContent = snapshots.length ? `${percent(combinedRemainingPercent)} remaining` : "No usage yet";
  remaining.className = combinedPacing ? `summary-remaining ${paceClass(combinedPacing)}` : "summary-remaining";
  const combinedBar = document.querySelector<HTMLElement>("#combined-bar")!;
  if (combinedPacing) setBar(combinedBar, combinedBudget ? (combined.usedUsd / combinedBudget) * 100 : 0, combinedPacing);
  document.querySelector("#summary-pacing")!.textContent = combinedPacing
    ? `Avg ${money(combinedPacing.averagePerElapsedDay)}/day · Available ${money(combinedPacing.requiredPerRemainingDay)}/day`
    : "No pacing yet";
```

with:

```ts
  currentState = state;
  const snapshots = PROVIDER_IDS.flatMap((id) => state.providers[id].snapshot ? [state.providers[id].snapshot!] : []);
  const combined = combineSnapshots(snapshots);
  const combinedBudget = PROVIDER_IDS.reduce((sum, id) => sum + state.providers[id].budgetUsd, 0);
  const cycle = snapshots[0];
  const summary = cycle
    ? computeSummary(
        PROVIDER_IDS.map((id) => state.providers[id].history),
        combined.usedUsd,
        combinedBudget,
        cycle.cycleStart,
        cycle.cycleEnd,
      )
    : undefined;

  renderSummary(summary);
```

- [ ] **Step 4: Recolor the provider rows in `src/popup.ts`**

Inside the `providersHost.replaceChildren(...)` map, replace the `if (snapshot) { ... }` block:

```ts
    if (snapshot) {
      const pacing = calculatePacing(snapshot.equivalentUsedUsd, snapshot.budgetUsd, snapshot.cycleStart, snapshot.cycleEnd);
      const metrics = document.createElement("div");
      metrics.className = "provider-metrics";
      const remainingLabel = document.createElement("strong");
      remainingLabel.className = paceClass(pacing);
      remainingLabel.textContent = `${percent(pacing.remainingPercent)} remaining`;
      const pace = document.createElement("span");
      pace.textContent = pacingText(pacing);
      const bar = document.createElement("div");
      bar.className = "usage-bar provider-bar";
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-label", `${PROVIDERS[id].name} budget used`);
      const fill = document.createElement("span");
      setBar(fill, snapshot.utilizationPercent, pacing);
      bar.append(fill);
      metrics.append(remainingLabel, pace, bar);
      row.append(metrics);
    }
```

with:

```ts
    if (snapshot) {
      const pacing = calculatePacing(snapshot.equivalentUsedUsd, snapshot.budgetUsd, snapshot.cycleStart, snapshot.cycleEnd);
      const status = fillStatus(snapshot.equivalentUsedUsd, snapshot.budgetUsd);
      const metrics = document.createElement("div");
      metrics.className = "provider-metrics";
      const remainingLabel = document.createElement("strong");
      remainingLabel.className = `text-${status}`;
      remainingLabel.textContent = `${percent(pacing.remainingPercent)} remaining`;
      const pace = document.createElement("span");
      pace.textContent = pacingText(pacing);
      const bar = document.createElement("div");
      bar.className = "usage-bar provider-bar";
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-label", `${PROVIDERS[id].name} budget used`);
      const fill = document.createElement("span");
      setFill(fill, snapshot.equivalentUsedUsd, snapshot.budgetUsd);
      bar.append(fill);
      metrics.append(remainingLabel, pace, bar);
      row.append(metrics);
    }
```

- [ ] **Step 5: Update `src/styles.css` — tokens**

Replace (light `:root`):

```css
  --red: #ff3b30;
  --red-text: #d92d25;
  color: var(--text);
```

with:

```css
  --red: #ff3b30;
  --red-text: #d92d25;
  --amber: #ff9500;
  --amber-text: #a15c00;
  color: var(--text);
```

Replace (dark scheme block — tokens and removal of the old pace override together):

```css
    --red: #ff453a;
    --red-text: #ff6961;
  }

  .usage-bar > span.pace-on-pace { background: #1c1c1e; box-shadow: inset 0 0 0 1px #98989d; }
}
```

with:

```css
    --red: #ff453a;
    --red-text: #ff6961;
    --amber: #ff9f0a;
    --amber-text: #ffb340;
  }
}
```

- [ ] **Step 6: Update `src/styles.css` — summary + bar classes**

Replace this block:

```css
.summary-top { display: flex; align-items: baseline; gap: 12px; }
.summary strong { font-size: 30px; font-weight: 700; letter-spacing: -0.045em; font-variant-numeric: tabular-nums; }
.summary #combined-limit { margin-left: 6px; color: var(--secondary); font-size: 15px; }
.summary-days { margin-left: auto; color: var(--secondary); font-size: 12px; font-weight: 500; white-space: nowrap; }
.summary-metrics { display: flex; align-items: baseline; gap: 12px; margin-top: 7px; white-space: nowrap; }
.summary-remaining { flex: none; color: var(--secondary); font-size: 13px; font-weight: 600; }

.usage-bar {
  width: 100%;
  height: 6px;
  overflow: hidden;
  border: 1px solid var(--track-border);
  border-radius: 999px;
  background: var(--track);
}

.summary-bar { margin-top: 8px; }
.summary-pacing { color: var(--secondary); font-size: 13px; font-variant-numeric: tabular-nums; }
.usage-bar > span { display: block; width: 0; height: 100%; border-radius: inherit; transition: width 180ms ease; }
.usage-bar > span.pace-under { background: var(--green); }
.usage-bar > span.pace-on-pace { background: #fff; box-shadow: inset 0 0 0 1px #8e8e93; }
.usage-bar > span.pace-over { background: var(--red); }
.pace-under { color: var(--green-text); }
.pace-on-pace { color: var(--secondary); }
.pace-over { color: var(--red-text); }
```

with:

```css
.summary-top { display: flex; align-items: baseline; gap: 12px; }
.summary strong { font-size: 30px; font-weight: 700; letter-spacing: -0.045em; font-variant-numeric: tabular-nums; }
.summary-days { margin-left: auto; color: var(--secondary); font-size: 12px; font-weight: 500; white-space: nowrap; }
.summary-allowance { margin-top: 6px; color: var(--secondary); font-size: 13px; font-variant-numeric: tabular-nums; }
.period-bars { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.period-head { display: flex; justify-content: space-between; color: var(--secondary); font-size: 12px; }
.period-value { font-variant-numeric: tabular-nums; }
.period-bar { margin-top: 3px; }
.summary-foot { margin-top: 10px; color: var(--secondary); font-size: 13px; font-variant-numeric: tabular-nums; }

.usage-bar {
  width: 100%;
  height: 6px;
  overflow: hidden;
  border: 1px solid var(--track-border);
  border-radius: 999px;
  background: var(--track);
}

.usage-bar > span { display: block; width: 0; height: 100%; border-radius: inherit; transition: width 180ms ease; }
.usage-bar > span.fill-green { background: var(--green); }
.usage-bar > span.fill-amber { background: var(--amber); }
.usage-bar > span.fill-red { background: var(--red); }
.text-green { color: var(--green-text); }
.text-amber { color: var(--amber-text); }
.text-red { color: var(--red-text); }
```

- [ ] **Step 7: Update `tests/popup-backup-behavior.test.ts` to use the new summary DOM**

The tests used `#combined-limit` (now removed) as a "did render re-run?" probe. Switch to the new `#month-label`, which shows `$monthSpent / $monthBudget` only when a snapshot/cycle exists. Make three edits.

Edit 7a — add imports and a snapshot helper. Replace:

```ts
import type { ExtensionMessage } from "../src/messages";
import { createInitialState } from "../src/state";
```

with:

```ts
import type { ExtensionMessage } from "../src/messages";
import { normalizeUsd } from "../src/normalization";
import { createInitialState } from "../src/state";
import type { ExtensionState } from "../src/types";

function stateWithClaudeSnapshot(budgets?: Partial<Record<"claude" | "chatgpt" | "cursor", number>>): ExtensionState {
  const state = createInitialState();
  if (budgets?.claude !== undefined) state.providers.claude.budgetUsd = budgets.claude;
  if (budgets?.chatgpt !== undefined) state.providers.chatgpt.budgetUsd = budgets.chatgpt;
  if (budgets?.cursor !== undefined) state.providers.cursor.budgetUsd = budgets.cursor;
  state.providers.claude.snapshot = normalizeUsd(
    "claude",
    400,
    state.providers.claude.budgetUsd,
    "2026-07-17T12:00:00.000Z",
    "2026-07-01",
    "2026-07-31",
    "page",
  );
  state.providers.claude.history = [{ date: "2026-07-17", equivalentUsedUsd: 400 }];
  return state;
}
```

Edit 7b — make `setupPopup` accept a custom initial state. Replace:

```ts
async function setupPopup(handleMessage: MessageHandler = () => {
  throw new Error("Unexpected popup message");
}) {
  vi.resetModules();
  document.open();
  document.write(popupMarkup);
  document.close();

  const initialState = createInitialState();
```

with:

```ts
async function setupPopup(
  handleMessage: MessageHandler = () => {
    throw new Error("Unexpected popup message");
  },
  initialState: ExtensionState = createInitialState(),
) {
  vi.resetModules();
  document.open();
  document.write(popupMarkup);
  document.close();

```

(Note: the `const initialState = createInitialState();` line is deleted because `initialState` is now a parameter; the `sendMessage` mock below already closes over `initialState`.)

Edit 7c — rewrite the "does not render" failure cases to probe `#month-label`. Replace:

```ts
  ])("does not render $name and recovers the controls", async ({ response, status }) => {
    const popup = await setupPopup((message) => {
      if (message.type === "IMPORT_DATA") return response();
      throw new Error(`Unexpected ${message.type} message`);
    });
    const originalLimit = document.querySelector("#combined-limit")?.textContent;
    const importedState = createInitialState();
    importedState.providers.claude.budgetUsd = 9_000;
    const { file } = createFile(createBackup(importedState, exportedAt));

    selectFile(popup.importFile, file);

    await vi.waitFor(() => {
      expect(popup.dataStatus.textContent).toBe(status);
    });
    expect(document.querySelector("#combined-limit")?.textContent).toBe(originalLimit);
    expect(popup.dataStatus.classList.contains("error")).toBe(true);
    expect(popup.importFile.value).toBe("");
    expectDataControlsEnabled(popup);
  });
```

with:

```ts
  ])("does not render $name and recovers the controls", async ({ response, status }) => {
    const popup = await setupPopup((message) => {
      if (message.type === "IMPORT_DATA") return response();
      throw new Error(`Unexpected ${message.type} message`);
    }, stateWithClaudeSnapshot());
    const originalMonth = document.querySelector("#month-label")?.textContent;
    const importedState = stateWithClaudeSnapshot({ claude: 9_000 });
    const { file } = createFile(createBackup(importedState, exportedAt));

    selectFile(popup.importFile, file);

    await vi.waitFor(() => {
      expect(popup.dataStatus.textContent).toBe(status);
    });
    expect(document.querySelector("#month-label")?.textContent).toBe(originalMonth);
    expect(popup.dataStatus.classList.contains("error")).toBe(true);
    expect(popup.importFile.value).toBe("");
    expectDataControlsEnabled(popup);
  });
```

Edit 7d — the success test. Replace:

```ts
    const importedState = createInitialState();
    importedState.providers.claude.budgetUsd = 900;
    importedState.providers.chatgpt.budgetUsd = 800;
    importedState.providers.cursor.budgetUsd = 700;
    importedState.settings.syncMinutes = 60;
    importedState.settings.retentionMonths = 6;
    importedState.settings.allowScheduledCursorFocus = true;
    const backup = createBackup(importedState, exportedAt);
    const { file } = createFile(backup);
    const originalLimit = document.querySelector("#combined-limit")?.textContent;
```

with:

```ts
    const importedState = stateWithClaudeSnapshot({ claude: 900, chatgpt: 800, cursor: 700 });
    importedState.settings.syncMinutes = 60;
    importedState.settings.retentionMonths = 6;
    importedState.settings.allowScheduledCursorFocus = true;
    const backup = createBackup(importedState, exportedAt);
    const { file } = createFile(backup);
    const originalMonth = document.querySelector("#month-label")?.textContent;
```

and, further down in the same test, replace:

```ts
    expect(document.querySelector("#combined-limit")?.textContent).not.toBe(originalLimit);
```

with:

```ts
    expect(document.querySelector("#month-label")?.textContent).not.toBe(originalMonth);
```

- [ ] **Step 8: Run the full suite, typecheck, and build**

Run: `pnpm test && pnpm typecheck && pnpm build`
Expected: all tests PASS; `typecheck` clean (no more `paceStatus`/`paceClass`/`setBar`/`combined-*` references); `vite build` succeeds.

- [ ] **Step 9: Commit**

```bash
git add popup.html src/popup.ts src/styles.css tests/popup-backup-behavior.test.ts
git commit -m "feat(popup): today/week/month summary with allowance, proj, left"
```

---

### Task 4: Docs — how-it-works copy + README

**Files:**
- Modify: `popup.html` (how-it-works view)
- Modify: `README.md`

**Interfaces:**
- Consumes: `.text-green` / `.text-amber` / `.text-red` classes from Task 3.
- Produces: nothing consumed by code.

- [ ] **Step 1: Update the how-it-works copy**

In `popup.html`, replace:

```html
          <section>
            <h2>Explains your pace</h2>
            <p><strong>Avg</strong> is usage per elapsed workday. <strong>Available</strong> is what remains for each workday through the month.</p>
          </section>
```

with:

```html
          <section>
            <h2>Splits spend by period</h2>
            <p>The summary shows <strong>Today</strong>, <strong>Week</strong> (Mon–Fri), and <strong>Month</strong> spend. <strong>allowance</strong> is what is safe to spend today — the budget left this month divided by remaining workdays; the bracketed figure spreads it over all remaining days. <strong>proj</strong> projects month-end at your current workday pace, and <strong>left</strong> is the budget minus month-to-date.</p>
          </section>
```

Then replace:

```html
          <p class="pace-key"><span class="pace-under">Green: below pace</span><span>Neutral: aligned</span><span class="pace-over">Red: above pace</span></p>
```

with:

```html
          <p class="pace-key"><span class="text-green">Green: under 80%</span><span class="text-amber">Amber: 80–100%</span><span class="text-red">Red: over</span></p>
```

- [ ] **Step 2: Update the README**

In `README.md`, replace:

```md
The extension includes rendered Usage-page collectors, local daily history,
session recovery, export/import/reset controls, and in-popup Overview, History,
Settings, and How It Works views.
```

with:

```md
The combined Overview splits spend into Today, Week (Mon–Fri), and Month bars
against a pace-based allowance, with a projected month-end total (proj) and
remaining budget (left). The extension includes rendered Usage-page collectors,
local daily history, session recovery, export/import/reset controls, and in-popup
Overview, History, Settings, and How It Works views.
```

- [ ] **Step 3: Verify build still succeeds**

Run: `pnpm build`
Expected: PASS (HTML/CSS/README changes only; no type impact).

- [ ] **Step 4: Commit**

```bash
git add popup.html README.md
git commit -m "docs: explain today/week/month, allowance, proj, left"
```

---

## Self-Review

**1. Spec coverage:**
- Combined summary only → Task 3 (provider rows only recolored). ✅
- Headline = today's spend → `renderSummary` sets `#combined-today` to `todaySpent`. ✅
- `$/hr` dropped → subline is `today · allowance $X ($Y)` only. ✅
- Week = ISO workweek (Mon–Fri) vs pace-based target → `isoWorkweek` + `weekTarget = targetPerWorkingDay × weekdaysInRange`. ✅
- Green/amber/red everywhere, retire pace-status → `fillStatus` for summary + provider bars; `paceStatus`/`.pace-*` removed. ✅
- Workday-based `proj` → `averagePerElapsedDay × totalWorkingDays`. ✅
- Keep "N days left", drop "% remaining"/"Avg/Available" from combined summary → `#summary-days` kept; metrics/pacing lines removed. ✅
- No data-fetching changes → only `pacing.ts`, `periods.ts`, `popup.*`, `styles.css`, docs, tests touched. ✅
- Week clamp to cycleStart → `weekStart = max(week.start, cycleStart)`, covered by test. ✅
- allowance bracket (all days) → `requiredPerRemainingDayAllDays`. ✅
- Docs (how-it-works + README) → Task 4. ✅
- Tests (`periods.test.ts` + `pacing.test.ts` update) → Tasks 1–2; popup test migration → Task 3 Step 7. ✅

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to". Every code step shows full code. ✅

**3. Type consistency:** `SummaryBreakdown` fields used in `renderSummary` (`todaySpent`, `weekSpent`, `monthSpent`, `todayAllowance`, `todayAllowanceAllDays`, `weekTarget`, `monthBudget`, `projectedMonth`, `left`, `remainingWorkingDays`) match the definition in Task 2. `computeSummary` signature `(histories, monthSpent, combinedBudget, cycleStart, cycleEnd, now?)` matches the call in Task 3 Step 3. `fillStatus(spent, target)` and `setFill(fill, spent, target)` signatures are consistent across summary and provider usages. `PacingMetrics` (no `paceStatus`, plus `requiredPerRemainingDayAllDays`) is consistent between Task 1 and its consumers. ✅

**Note on ordering:** After Task 1, `pnpm typecheck` fails only inside `src/popup.ts` until Task 3 lands. This is expected; per-task test commands in Tasks 1–2 scope to the specific test files so they pass independently.
