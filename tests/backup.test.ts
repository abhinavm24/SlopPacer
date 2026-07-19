import { describe, expect, it } from "vitest";
import {
  backupErrorMessage,
  createBackup,
  parseBackupText,
  parseBackupValue,
} from "../src/backup";
import { createInitialState } from "../src/state";
import type { ExtensionState } from "../src/types";

const EXPORTED_AT = "2026-07-19T12:00:00.000Z";

function populatedState(): ExtensionState {
  const state = createInitialState();
  state.lastRefreshAt = "2026-07-19T11:30:00.000Z";
  state.providers.claude.history = [{
    date: "2026-07-19",
    equivalentUsedUsd: 42,
    actualUsedUsd: 42,
    nativeUsed: 42,
  }];
  state.settings.syncMinutes = 30;
  return state;
}

describe("backup format", () => {
  it("creates and parses a version 1 full-state backup", () => {
    const state = populatedState();
    const backup = createBackup(state, EXPORTED_AT);

    expect(backup).toEqual({
      format: "slop-pacer-backup",
      formatVersion: 1,
      exportedAt: EXPORTED_AT,
      state,
    });
    expect(parseBackupText(JSON.stringify(backup))).toEqual({ ok: true, backup });
  });

  it("rejects malformed JSON", () => {
    expect(parseBackupText("{")).toEqual({ ok: false, error: "invalid_json" });
  });

  it("rejects a raw legacy state export", () => {
    expect(parseBackupValue(populatedState())).toEqual({ ok: false, error: "invalid_format" });
  });

  it("rejects an unsupported backup version", () => {
    const backup = { ...createBackup(populatedState(), EXPORTED_AT), formatVersion: 2 };

    expect(parseBackupValue(backup)).toEqual({ ok: false, error: "unsupported_version" });
  });

  it("rejects a backup with a missing provider", () => {
    const backup = structuredClone(createBackup(populatedState(), EXPORTED_AT));
    delete (backup.state.providers as Partial<ExtensionState["providers"]>).cursor;

    expect(parseBackupValue(backup)).toEqual({ ok: false, error: "invalid_data" });
  });

  it("rejects invalid settings", () => {
    const backup = structuredClone(createBackup(populatedState(), EXPORTED_AT));
    backup.state.settings.syncMinutes = 0;

    expect(parseBackupValue(backup)).toEqual({ ok: false, error: "invalid_data" });
  });

  it("rejects invalid dates", () => {
    const backup = structuredClone(createBackup(populatedState(), EXPORTED_AT));
    backup.state.providers.claude.history[0]!.date = "2026-99-99";

    expect(parseBackupValue(backup)).toEqual({ ok: false, error: "invalid_data" });
  });

  it("rejects non-finite numbers at the worker boundary", () => {
    const backup = structuredClone(createBackup(populatedState(), EXPORTED_AT));
    backup.state.providers.claude.budgetUsd = Number.POSITIVE_INFINITY;

    expect(parseBackupValue(backup)).toEqual({ ok: false, error: "invalid_data" });
  });

  it("maps every error code to concise popup copy", () => {
    expect(backupErrorMessage("invalid_format")).toBe("That file is not a Slop Pacer backup.");
    expect(backupErrorMessage("unsupported_version")).toBe("This backup version is not supported.");
    expect(backupErrorMessage("import_failed")).toBe("Slop Pacer could not restore that backup.");
  });
});
