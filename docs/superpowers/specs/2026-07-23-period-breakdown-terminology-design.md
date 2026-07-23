# Period breakdown & pace terminology for the combined summary

**Date:** 2026-07-23
**Status:** Approved (design)

## Summary

Adopt the display features and terminology from the reference
`eg-internal/claude-cost-estimate-widget` into SlopPacer's combined overview
summary, **without changing how usage data is collected**. SlopPacer keeps
reading normalized totals from providers' rendered Usage pages.

The combined summary changes from a single month-to-date bar into a
Today / Week / Month breakdown with pace-based terminology (allowance, proj,
left), matching the reference widget's compact layout.

## Motivation

The reference widget presents cost with three period bars and a compact,
information-dense vocabulary (allowance / proj / left) that reads better than
SlopPacer's current "% remaining · Avg $/day · Available $/day" summary.
SlopPacer already stores everything needed to render this because
`recordSnapshot` persists a **per-day delta** per provider — so today's and this
week's spend are already captured. This is a display/terminology change, not a
data change.

## Non-goals

- **No change to data fetching.** No transcripts, no private JSON endpoints, no
  new host permissions. Values derive only from existing `ProviderSnapshot`
  (month-to-date) and `history[]` (per-day deltas).
- **No burn rate (`$/hr`).** The reference computes it from sub-daily timestamped
  transcript events, which SlopPacer does not collect (daily granularity only).
  It is intentionally dropped.
- **Provider rows keep their single-bar layout.** Only the combined summary gets
  the three-bar treatment. (The per-provider bars are only *recolored*; see
  Coloring.)

## Locked decisions

| Decision | Choice |
| --- | --- |
| Scope of three-bar layout | Combined summary only |
| Headline number | Today's combined spend |
| `$/hr` burn rate | Dropped |
| Week window | Current ISO **workweek** (Mon–Fri) |
| Week bar target | Pace-based weekly target |
| Bar coloring | Green/amber/red by each bar's own fill, applied **everywhere** (retire under/on-pace/over) |
| `proj` basis | Workday-based (avg per elapsed workday × total workdays) |
| Summary extras | Keep "N days left"; drop "% remaining" and "Avg/Available" |

## Combined summary layout

```
$201  ·············································  11 days left
today · allowance $91 ($83)
Today   ██████████████  $201 / $91    (red — over allowance)
Week    ██████░░░░░░░░  $201 / $435   (amber)
Month   ███░░░░░░░░░░░  $688 / $2000  (green)
proj $3556 · left $1312
```

Numbers are illustrative. Note the hard invariant: the **Today bar's target
equals the allowance** ($91 here), and the **Week target** is the pace-based
weekly figure (`targetPerWorkingDay × workdays this week`, ≈ $87 × 5 = $435 at a
$2000 budget over 23 workdays).

- **Headline** = today's combined spend (big number).
- **"N days left"** = remaining workdays this cycle (top-right of the headline row).
- **Subline** = `today · allowance $X ($Y)`.
- **Three bars** — `label` + `$spent / $target`, each colored independently.
- **Footer** = `proj $… · left $…`.

## Definitions & math

All amounts are USD. "Combined" = sum across the three providers.

- **Today spend** = sum over providers of the `history` entry for today's date
  (`equivalentUsedUsd`).
- **Week spend** = sum over providers of `history` entries whose date falls in the
  current ISO workweek (Monday–Friday), clamped to `date >= cycleStart` so a week
  straddling a month boundary cannot exceed the month figure.
- **Month spend** = combined `snapshot.equivalentUsedUsd` (month-to-date).
- **allowance** (`todayAllowance`) = `requiredPerRemainingDay` = remaining budget ÷
  remaining **workdays** (already computed by `calculatePacing`).
- **allowance bracket** (`todayAllowanceAllDays`) = remaining budget ÷ remaining
  **calendar** days.
- **Week target** (`weekTarget`) = `targetPerWorkingDay × W`, where
  `targetPerWorkingDay = combinedBudget ÷ totalWorkingDays` and `W` = number of
  workdays in the current workweek that fall within the current month.
- **Month target** = combined monthly budget.
- **proj** (`projectedMonth`) = `averagePerElapsedDay × totalWorkingDays`
  (`averagePerElapsedDay` = monthToDate ÷ elapsedWorkingDays). Workday-based to
  stay consistent with the allowance/pace model.
- **left** = `max(0, combinedBudget − monthSpent)`.
- **Fill status** (`fillStatus(spent, target)`): `green` if `spent/target < 0.8`,
  `amber` if `< 1.0`, else `red`; if `target <= 0`, `red`.

## Architecture

Follow the existing pattern of pure, clock-injected functions (like
`calculatePacing(..., now)`) so the new logic is unit-testable with a frozen
clock and `popup.ts` stays a dumb renderer.

### New module: `src/periods.ts` (pure)

- `isoWorkweek(now): { start: string; end: string }` — Monday–Friday of the
  current week as `YYYY-MM-DD`.
- `sumForDate(history, date): number`
- `sumRange(history, start, end): number` — inclusive date range.
- `fillStatus(spent, target): "green" | "amber" | "red"`.
- `computeSummary(histories, combinedBudget, cycleStart, cycleEnd, now): SummaryBreakdown`
  where `histories` is an array of the three providers' `history[]` arrays;
  `computeSummary` merges them by date internally. Returns:
  `{ todaySpent, weekSpent, monthSpent, todayAllowance, todayAllowanceAllDays,
     weekTarget, monthBudget, projectedMonth, left, remainingWorkingDays }`.
  Internally reuses `calculatePacing` for the allowance/day-count figures.

### `src/pacing.ts`

- Add `requiredPerRemainingDayAllDays` (remaining ÷ remaining calendar days) to
  `PacingMetrics`, feeding the allowance bracket.
- **Remove `paceStatus`** from `PacingMetrics` — it only drove the old 3-state
  coloring, which is replaced by fill-based coloring.

### `popup.html`

Restructure `#overview-view .summary` into: headline row (`$today` +
"N days left"), subline, three bars (Today/Week/Month), footer (`proj · left`).
Provider section markup unchanged.

### `popup.ts`

- Render the combined summary from `computeSummary`.
- Replace all `paceClass`/`setBar` usage with `fillStatus`, including the
  per-provider bars (colored by month-to-date vs the provider's monthly budget).
- Drop the `pacingText`/`paceClass` helpers tied to `paceStatus`.

### `styles.css`

- Add `--amber` / `--amber-text` tokens for light and dark schemes
  (Apple-style `#ff9500` / `#ff9f0a`).
- Add `.fill-green` / `.fill-amber` / `.fill-red` bar-fill classes.
- Add the three-bar + footer layout styles.
- Remove `.pace-under` / `.pace-on-pace` / `.pace-over` classes.

### Docs

- Update the "How it works" view: describe allowance / today / week / month /
  proj / left and the green (<80%) / amber (80–100%) / red (>100%) thresholds;
  replace the old pace-key legend.
- Update `README.md` to mention the Today/Week/Month breakdown and terminology.

## Testing

- New `tests/periods.test.ts` (frozen clock):
  - today sum and week (Mon–Fri) sum from `history`.
  - week straddling a month boundary is clamped to `cycleStart`.
  - allowance (workday) vs allowance bracket (all days).
  - weekly pace target = `targetPerWorkingDay × W`.
  - workday-based projection.
  - `left`.
  - `fillStatus` boundaries at 0.79 / 0.80 / 1.00 / 1.01 and `target <= 0`.
- Update `tests/pacing.test.ts`: drop `paceStatus` assertions; add
  `requiredPerRemainingDayAllDays` coverage.

## Risks & edge cases

- **No history yet / provider disconnected:** today/week sums are 0; bars render
  empty; headline shows `$0.00`. Month/left still come from the snapshot.
- **Different provider cycles:** cycles are calendar months in practice; the
  combined cycle uses `snapshots[0]` as the existing pacing code already does.
- **Week clamp:** using `date >= cycleStart` preserves the invariant that Week
  cannot exceed Month.
- **Zero budget:** `fillStatus` returns `red` when `target <= 0`; `proj`/allowance
  guard against divide-by-zero as `calculatePacing` already does.
