# Concise Popup Copy Design

## Goal

Reduce reading on Home and How It Works without changing usage calculations, controls, or the Apple Fitness visual system. The entire How It Works view must fit within the popup without vertical scrolling.

## Home

- Remove the explanatory `summary-caption` element and its rendering and styling hooks.
- Keep the live allowance, projected spend, and budget-left values in the hero.
- Preserve pace rings, period bars, provider rows, IDs, and progressbar accessibility.

## How It Works

Keep the four existing topics as compact cards with one sentence each:

1. **Collects usage:** Uses signed-in usage pages—no API keys; Cursor may briefly appear during refresh.
2. **Tracks against budget:** Combines provider spend against monthly budgets; Cursor credits convert to dollars.
3. **Shows your pace:** Today, workweek, and month show spend against pace, projection, and budget left.
4. **Stays local:** Budgets and history stay in browser storage; backup controls live in Settings.

Retain the compact green/amber/red threshold key. Tighten card spacing and padding only as needed to fit the 538px content area.

## Accessibility and behavior

- Preserve navigation, keyboard focus, semantic headings, contrast, light/dark themes, and reduced-motion behavior.
- Keep the popup at 410×596px.
- Prevent vertical overflow on How It Works at the popup viewport.

## Verification

- Add a DOM regression assertion that `summary-caption` is absent.
- Run the full Vitest suite, TypeScript typecheck, and production build.
- Render Home and How It Works in light and dark mode and verify no clipping or How It Works vertical overflow.
