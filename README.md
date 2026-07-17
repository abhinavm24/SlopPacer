# Slop Pacer

A local-first Chrome/Edge extension that combines month-to-date AI usage from:

- Claude
- ChatGPT
- Cursor

Each provider has a configurable monthly budget (default: **$2,000**). The extension
refreshes on a configurable interval (15 minutes by default), keeps normalized daily history locally, and shows both the
combined budget and provider-level detail.

The extension includes rendered Usage-page collectors, local daily history,
session recovery, export/reset controls, and in-popup Overview, History, Settings, and
How It Works views. See [INVESTIGATION.md](INVESTIGATION.md) for the provider constraints.

## Development

Requirements: Node.js 22+ and pnpm 11+.

```bash
pnpm install
pnpm test
pnpm build
```

Load `dist/` as an unpacked extension from `chrome://extensions` or
`edge://extensions` with Developer mode enabled.

## Privacy model

- Usage data stays in `chrome.storage.local`.
- Cookies, bearer tokens, emails, and raw provider responses are never persisted.
- Host permissions are limited to Claude, ChatGPT, and Cursor.
- The extension reuses an open provider Usage page when available. Otherwise it briefly
  opens one, reads it, and closes only the tab it created. During a manual refresh,
  Cursor's page is temporarily shown because its dashboard defers loading usage data
  while hidden. Scheduled refreshes do this only when enabled in Settings (off by default).
- When a session expires, the extension marks that provider as requiring sign-in. The
  user can open the official provider page with **Sign in**.

## Provider behavior

- Claude, ChatGPT, and Cursor all read normalized totals from their rendered Usage pages.
  Private JSON endpoints, bearer tokens, and provider-specific API authentication are
  never inspected or stored.
- If a session expires, the last successful value remains visible and is marked stale.
  Use **Sign in**, finish authentication on the official provider page, and refresh.
