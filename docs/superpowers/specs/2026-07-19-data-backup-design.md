# Data Backup and Restore Design

## Goal

Add a complete, local backup-and-restore flow for Slop Pacer. Export will download
a versioned JSON backup. Import will validate a backup, ask for confirmation, and
replace all extension data without contacting provider services.

## Decisions

- Import replaces all local Slop Pacer state.
- Only the new versioned backup format is accepted. Existing raw-state exports are
  intentionally unsupported.
- A successful import restores settings, budgets, snapshots, histories, connection
  statuses, and timestamps exactly.
- Import does not trigger a provider refresh.
- The current uncommitted history-chart work remains outside this feature except for
  additive popup layout changes around the existing data controls.

## Backup Format

Version 1 uses this envelope:

```ts
interface BackupFileV1 {
  format: "slop-pacer-backup";
  formatVersion: 1;
  exportedAt: string;
  state: ExtensionState;
}
```

The backup format version is separate from `ExtensionState.schemaVersion`. This
allows later releases to migrate old backup envelopes even if the internal storage
shape changes independently.

`exportedAt` is an ISO 8601 timestamp. Version 1 requires the current state schema,
including all three providers and `schemaVersion: 3`.

## Architecture

### Backup module

Create `src/backup.ts` as the format boundary. It will:

- define `BackupFileV1`;
- build an envelope from an `ExtensionState`;
- parse unknown JSON with a strict Zod schema;
- reject unsupported format versions, missing providers, invalid settings, invalid
  dates, and non-finite numeric values; and
- return concise validation errors suitable for the popup.

The module will remain independent of the DOM and Chrome APIs so format behavior can
be unit-tested directly.

### Background worker

Extend the runtime message union with an import request and a discriminated import
response. The background worker remains the only component that replaces persisted
state.

For export, the worker reads the current state and returns a versioned envelope.

For import, the worker:

1. validates the envelope again at the persistence boundary;
2. waits for any in-progress provider refresh to finish;
3. replaces the value stored under `aiUsageMeterState`;
4. reschedules the refresh alarm from the imported `syncMinutes`;
5. updates the authentication badge; and
6. returns the imported state.

Waiting for an active refresh prevents its later write from overwriting the restored
backup. The worker does not start a new refresh after import.

### Popup

Add an **Import JSON** button beside **Export JSON** and **Clear history**, backed by
a visually hidden file input that accepts JSON.

The import flow is:

1. open the file picker;
2. reject files larger than 1 MiB;
3. read and parse the selected file;
4. validate it locally to provide immediate feedback;
5. show a native confirmation stating that all local Slop Pacer data will be
   replaced;
6. send the envelope to the background worker; and
7. render the returned state and show an accessible success message.

The file input is cleared after every attempt so the same file can be selected again.
A dedicated `aria-live` output near the data controls reports import/export results
without reusing settings-form status.

Export keeps the existing download behavior but serializes the new envelope. The
filename remains `slop-pacer-YYYY-MM-DD.json`.

## Validation and Error Handling

Validation occurs before confirmation and again before persistence. A cancellation,
file read error, malformed JSON document, unsupported backup version, or schema
validation failure leaves storage unchanged.

The popup reports one concise error, such as:

- `That file is not a Slop Pacer backup.`
- `This backup version is not supported.`
- `The backup contains invalid Slop Pacer data.`
- `The selected backup is larger than 1 MiB.`

Unexpected worker failures return a typed failure response instead of being mistaken
for an `ExtensionState`. Import and export controls are disabled only while their
operation is running.

## Privacy and Security

Backup and restore are local browser operations. No file content is uploaded or sent
to provider sites. Strict validation prevents arbitrary JSON from becoming extension
state, while the 1 MiB limit avoids reading unexpectedly large files in the popup.

Backups contain the same local data already described by the privacy model: settings,
normalized usage snapshots, and daily history. They do not contain cookies, bearer
tokens, emails, or raw provider responses.

## Testing

Add unit tests for:

- creating a correctly versioned envelope;
- accepting a valid round trip;
- rejecting raw legacy exports;
- rejecting malformed JSON and the wrong format or format version;
- rejecting missing providers, invalid settings, invalid dates, and non-finite
  numbers; and
- replacing the full stored state through the state helper.

Run the complete Vitest suite, TypeScript typecheck, and production build. Manually
verify that export downloads a readable file, import confirmation can be cancelled,
successful import immediately updates the popup, and invalid files do not alter data.

## Documentation

Update the README and the in-popup **How It Works** copy to say that Settings can
export and restore a local backup. Make explicit that import replaces current local
data.

## Acceptance Criteria

- Export downloads a valid version 1 Slop Pacer backup.
- Import accepts a valid version 1 backup and replaces all local state after
  confirmation.
- The restored refresh interval is scheduled and the popup updates immediately.
- Import does not refresh providers or make network requests.
- Raw legacy exports and invalid backups are rejected without changing storage.
- Import status is accessible and the same file can be retried.
- Tests, typecheck, and production build pass.
