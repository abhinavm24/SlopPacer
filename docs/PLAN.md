# Chrome extension implementation plan

## Implementation status

Implemented on 2026-07-17. The phases below now describe the delivered architecture
and its verification contract. Provider web schemas are private and may drift, so the
page-assisted fallbacks and fixture tests remain intentional parts of the design.

## Product outcome

Show one month-to-date budget across Claude, ChatGPT, and Cursor, each configured to a
$2,000 monthly allowance by default. The combined allowance is therefore $6,000.
Users can inspect each provider, daily history, remaining budget, data freshness, and
sign-in state without installing local daemons or parsing transcripts.

## Architecture

```text
chrome.alarms (15 minutes)
  -> refresh coordinator
      -> Claude adapter
      -> ChatGPT page-assisted adapter
      -> Cursor adapter
  -> schema validation and normalization
  -> chrome.storage.local
  -> popup + detail/options page + badge
```

## Phase 1: extension and authentication foundation

- Keep the Manifest V3 service worker event-driven.
- Refresh on install, browser startup, every 15 minutes, and manual request.
- Add a refresh mutex so alarms and button clicks cannot overlap.
- Implement provider result types: success, auth required, retryable failure, permanent
  failure, and unsupported schema.
- Implement the sign-in recovery contract from `INVESTIGATION.md`.
- Add one-click provider usage URLs and never auto-open login tabs.
- Add sanitized structured logging behind a developer flag.

Acceptance:

- The extension loads unpacked in Chrome and Edge.
- Simulated `401`/`403` results show the correct sign-in action.
- One provider failure does not block the other two.

## Phase 2: provider adapters

### Claude

- Discover current organization/account IDs from the authenticated page/bootstrap.
- Fetch summary, limit, and daily product spend.
- Validate responses with Zod.
- Convert USD minor units using the response exponent.
- Reconcile the summary/daily gap as pending usage.

### Cursor

- Discover current team and user IDs.
- Query hard limit and daily spend for month start through now in UTC.
- Fetch event pages only on demand for detail; do not fetch all events every 15 minutes.
- Convert cents using response semantics, not display strings.

### ChatGPT

- Implement a content script limited to the authenticated Usage settings surface.
- Prefer extracting the already-rendered monthly limit/used/remaining values.
- If request observation is required, capture only the normalized response payload and
  never expose or persist authorization headers.
- Keep a cookie-only direct request disabled because investigation proved it returns
  `401`.
- Store cumulative snapshots so daily deltas can be derived going forward.

Acceptance:

- Each adapter passes sanitized fixture tests.
- IDs are discovered dynamically and never committed.
- Expired sessions reliably become `auth_required`.

## Phase 3: storage and aggregation

Persist:

- Latest snapshot per provider.
- Current-month cumulative snapshots.
- Daily buckets for 13 months.
- Last attempt, last success, source, freshness, and sanitized error.

Compaction:

- Keep 15-minute samples for seven days.
- Compact older samples into daily buckets.
- Prefer server-provided Claude/Cursor daily records.
- Derive ChatGPT daily changes from cumulative snapshots.
- Preserve negative adjustments caused by provider reconciliation.

Normalization:

- Claude and Cursor: actual USD.
- ChatGPT: native credits plus budget-equivalent USD.
- Never label budget-equivalent ChatGPT usage as billed USD.

## Phase 4: product UI

Popup:

- Combined used / $6,000 and remaining.
- Provider rows with used, limit, percentage, freshness, and connection state.
- Refresh and settings actions.
- Sign-in button only when authentication is required.

Detail page:

- Daily stacked chart.
- Actual versus budget-equivalent legend.
- Product/model breakdown where available.
- Pending/unattributed usage.
- Month-end projection.
- Provider-native metrics and last successful refresh.

Options:

- Editable provider budgets.
- Retention duration.
- Optional sign-in notification preference.
- Data export and local-history reset.

Before this phase, produce and approve a visual concept for popup, authentication error,
partial-data, empty, and detail states. The current scaffold is not that final design.

## Phase 5: resilience and security

Test:

- 401/403, redirect to login, revoked session, and successful reauthentication.
- 429/5xx with bounded exponential retry.
- Browser sleep and delayed alarms.
- UTC month rollover and provider cycle boundaries.
- Provider corrections and negative deltas.
- Missing fields, changed schemas, and partial provider availability.
- Large Cursor event histories without exceeding extension storage limits.

Security requirements:

- No `cookies`, `debugger`, or broad all-sites permission in the shipping build.
- No remote executable code.
- No bearer token, password, email, request header, or raw response persistence.
- Escape all provider-derived strings before rendering.
- Keep content scripts restricted to the exact provider origins and usage surfaces.

## Phase 6: delivery

- Add CI for typecheck, tests, and production build.
- Add deterministic extension packaging.
- Verify unpacked installation in Chrome and Edge.
- Document every permission in user-facing language.
- Run a final privacy and schema-drift review before store submission.

## Explicitly out of scope

- Local Claude transcript parsing.
- Public-list-price estimation or calibration.
- CLI/headless scraping.
- Capturing authentication tokens.
- Organization-admin APIs or admin credentials.
- Automatic login or password handling.
