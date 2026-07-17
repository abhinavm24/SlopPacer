# Provider investigation

Date: 2026-07-17. All requests below were observed from the authenticated usage pages
in Chrome. Identifiers and authorization values are deliberately omitted.

## Conclusions

- Claude and Cursor expose structured month-to-date and daily usage data in USD.
- ChatGPT exposes a structured monthly aggregate in credits, not USD.
- ChatGPT's monthly endpoint returned `401` when replayed with cookies alone; its web
  client adds a bearer header and account header. The extension must not capture or
  persist that bearer token.
- A `401` or `403` is an authentication state, not a generic provider error. The UI
  should show **Sign in**, explain which provider needs attention, and open that
  provider's own usage page only after the user clicks.

## Claude

Observed endpoints:

```text
GET /api/organizations/{organizationId}/usage
GET /api/organizations/{organizationId}/overage_spend_limit?account_uuid={accountId}
GET /api/organizations/{organizationId}/usage/spend
    ?start_date=YYYY-MM-DD
    &end_date=YYYY-MM-DD
    &group_by=product_surface
    &granularity=daily
```

The summary exposes USD minor units for used and limit. The spend report exposes daily
series with product, cost, request count, and input/output/cache token classes. Its
totals expose product share and change versus the prior period.

The summary can be fresher than the daily/product report. Treat summary spend as the
authoritative MTD number and represent any gap as pending/unattributed.

## ChatGPT

Observed endpoints:

```text
GET /backend-api/accounts/{accountId}/spend-controls/current-user/monthly-usage
GET /backend-api/wham/usage
```

The monthly response exposes effective limit, enforcement mode, limit mode, and current
usage. The current workspace reports credits. For a $2,000 organizational
budget, normalize utilization proportionally while retaining and displaying the native
credit values.

The browser request includes both bearer authorization and an account header. A
cookie-only replay returned `401`. Phase one must therefore use a page-assisted adapter
or another provider-supported session mechanism; bearer extraction is out of scope.

No daily history request was emitted by the Usage settings page. Until another supported
source is found, build ChatGPT daily history from timestamped cumulative snapshots.

## Cursor

Observed endpoints:

```text
POST /api/dashboard/get-hard-limit
POST /api/dashboard/get-daily-spend-by-category
POST /api/dashboard/get-filtered-usage-events
```

Cursor exposes the per-user monthly USD limit, daily spend in cents, token counts,
categories/models, and paginated usage events. Requests use team/user identifiers and
UTC millisecond boundaries. Discover identifiers from the authenticated session rather
than hardcoding them.

## Authentication recovery contract

1. An adapter returns `auth_required` on `401`, `403`, or a verified login redirect.
2. The background worker retains the last successful snapshot and marks it stale.
3. The toolbar badge becomes `!`; the popup identifies the affected provider.
4. No login page opens automatically during a scheduled refresh.
5. Clicking **Sign in** opens the provider's own usage URL in an active tab.
6. The extension explains: "Complete sign-in, then return and refresh."
7. A successful retry clears the badge and authentication message.
8. Prompts are rate-limited so a persistent expiry does not nag every 15 minutes.

Never store cookies, passwords, bearer tokens, raw request headers, or full raw
responses. Persist only normalized usage, daily buckets, connection state, and
sanitized errors.
