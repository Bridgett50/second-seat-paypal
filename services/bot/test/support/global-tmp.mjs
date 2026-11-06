// Per-run test temp root (vitest globalSetup). Each run gets a fresh
// mkdtemp dir; TMPDIR/TMP/TEMP and SS_TEST_TMP_ROOT point at it, and
// MUSE_STATE_FILE / MUSE_COST_LOG_FILE default into it unless the
// caller (e.g. scripts/ci/repeat-check.sh) already set them. Torn down
// (recursive rm) when the run finishes, so nothing survives.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";

export default function setup() {
  const root = mkdtempSync(join(os.tmpdir(), "ss-test-run-"));
  process.env["TMPDIR"] = root;
  process.env["TMP"] = root;
  process.env["TEMP"] = root;
  process.env["SS_TEST_TMP_ROOT"] = root;
  if (!process.env["MUSE_STATE_FILE"]) {
    process.env["MUSE_STATE_FILE"] = join(root, ".muse-daily-state.json");
  }
  if (!process.env["MUSE_COST_LOG_FILE"]) {
    process.env["MUSE_COST_LOG_FILE"] = join(root, ".cost-log.jsonl");
  }
  return function teardown() {
    rmSync(root, { recursive: true, force: true });
  };
}
