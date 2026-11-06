// verify-run: the offline verification-layer runner over a recorded run.
// Fixture inputs only; fetch is guarded inside the script; temp dirs only.
// @ts-expect-error untyped script module
import { VerifyRunUsageError, fetchCalls, parseArgs, verifyRun } from "../scripts/verify-run.mjs";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { MockRedactor } from "../src/private/redact.js";

const botDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const heroInput = join(botDir, "fixtures", "hero-input");
const heroBrief = join(botDir, "fixtures", "hero-brief.recorded.json");
const heroIds = ["e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8", "e9"];
const supported = JSON.stringify({ grade: "supported", missing_qualifier: null });

const made: string[] = [];
afterEach(() => {
  while (made.length > 0) rmSync(made.pop()!, { recursive: true, force: true });
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "verify-run-"));
  made.push(d);
  return d;
}
function claimsFile(verdicts: Record<string, unknown>): string {
  const p = join(tmp(), "claims.json");
  writeFileSync(p, JSON.stringify(verdicts));
  return p;
}
async function heroApproved(): Promise<{ redactedText: string; spans: Array<{ start: number; end: number; label: string }> }> {
  const transcript = readFileSync(join(heroInput, "transcript.txt"), "utf8");
  const redacted = await new MockRedactor().redactText(transcript);
  return {
    redactedText: redacted.maskedText,
    spans: redacted.spans.map((s) => ({ start: s.start, end: s.end, label: s.label })),
  };
}

describe("verify-run", () => {
  it("verifies the hero run when every check passes, and writes verification.json", async () => {
    const out = tmp();
    const claims = claimsFile(Object.fromEntries(heroIds.map((id) => [id, supported])));
    const approved = await heroApproved();
    const report = await verifyRun({ input: heroInput, brief: heroBrief, meetingId: "hero-input", claims, out, ...approved });
    expect(report.checks.redaction).toMatchObject({ passed: true, ownerReviewRequired: true });
    expect(report.checks.brief.passed).toBe(true);
    expect(report.checks.brief.entries).toBe(9);
    expect(report.checks.claims).toMatchObject({ status: "ran", passed: true });
    expect(report).toMatchObject({ passed: true, complete: true, networkCalls: 0 });
    expect(JSON.parse(readFileSync(join(out, "verification.json"), "utf8"))).toEqual(report);
  });

  it("keeps heuristic findings as owner escalations, not silent passes", async () => {
    const report = await verifyRun({ input: heroInput, brief: heroBrief, skipClaims: true });
    expect(report.checks.brief.escalations.length).toBeGreaterThan(0);
    expect(report.checks.brief.escalations).toContainEqual({ entryId: "e4", reason: "request_not_accepted" });
  });

  it("blocks when the approved redaction is missing or still contains the source text", async () => {
    const missing = await verifyRun({ input: heroInput, brief: heroBrief, skipClaims: true });
    expect(missing.checks.redaction.passed).toBe(false);
    expect(missing.checks.redaction.feedback[0]).toMatch(/not supplied/);
    expect(missing.passed).toBe(false);
    const transcript = readFileSync(join(heroInput, "transcript.txt"), "utf8");
    const approved = await heroApproved();
    const leaked = await verifyRun({
      input: heroInput,
      brief: heroBrief,
      skipClaims: true,
      redactedText: transcript,
      spans: approved.spans,
    });
    expect(leaked.checks.redaction.passed).toBe(false);
    expect(leaked.checks.redaction.feedback.join("\n")).not.toContain("Dana Okafor");
    const dir = tmp();
    const redactedPath = join(dir, "redacted.txt");
    const spansPath = join(dir, "spans.json");
    writeFileSync(redactedPath, approved.redactedText);
    writeFileSync(spansPath, JSON.stringify(approved.spans));
    const fromFiles = await verifyRun({
      input: heroInput,
      brief: heroBrief,
      skipClaims: true,
      redacted: redactedPath,
      spans: spansPath,
    });
    expect(fromFiles.checks.redaction.passed).toBe(true);
    writeFileSync(spansPath, "not json");
    const badSpans = await verifyRun({
      input: heroInput,
      brief: heroBrief,
      skipClaims: true,
      redacted: redactedPath,
      spans: spansPath,
    });
    expect(badSpans.checks.redaction.passed).toBe(false);
    expect(badSpans.checks.redaction.feedback[0]).toMatch(/unreadable/);
  });

  it("fails closed when no judge output is supplied or claims are skipped", async () => {
    const notRun = await verifyRun({ input: heroInput, brief: heroBrief });
    expect(notRun.checks.claims).toMatchObject({ status: "not_run", passed: false });
    expect(notRun).toMatchObject({ passed: false, complete: false });
    const skipped = await verifyRun({ input: heroInput, brief: heroBrief, skipClaims: true });
    expect(skipped.checks.claims.status).toBe("skipped");
    expect(skipped.passed).toBe(false);
  });

  it("blocks one malformed judge verdict and names only that entry", async () => {
    const verdicts: Record<string, unknown> = Object.fromEntries(heroIds.map((id) => [id, supported]));
    verdicts["e3"] = "{\"grade\":\"supp";
    const report = await verifyRun({ input: heroInput, brief: heroBrief, claims: claimsFile(verdicts) });
    expect(report.passed).toBe(false);
    expect(report.checks.claims.feedback).toEqual(["entry e3: judge output unreadable (not valid JSON): blocked (fail-closed)"]);
  });

  it("blocks an unreadable claims file", async () => {
    const p = join(tmp(), "claims.json");
    writeFileSync(p, "not json");
    const report = await verifyRun({ input: heroInput, brief: heroBrief, claims: p });
    expect(report.checks.claims.passed).toBe(false);
  });

  it("blocks a brief for a different meeting and a dangling citation", async () => {
    const outer = JSON.parse(readFileSync(heroBrief, "utf8"));
    const brief = JSON.parse(outer.rawText);
    brief.entries[0].citations[0].segmentId = "t-99:99";
    const p = join(tmp(), "brief.json");
    writeFileSync(p, JSON.stringify(brief));
    const report = await verifyRun({ input: heroInput, brief: p, meetingId: "other-meeting", skipClaims: true });
    expect(report.checks.brief.passed).toBe(false);
    expect(report.checks.brief.feedback).toEqual([
      "meeting: brief meetingId hero-input does not match expected other-meeting",
      "entry e1: cites unknown segment t-99:99",
    ]);
  });

  it("blocks a recorded brief whose rawText is not JSON", async () => {
    const p = join(tmp(), "brief.json");
    writeFileSync(p, JSON.stringify({ rawText: "Sure! Here is the brief" }));
    const report = await verifyRun({ input: heroInput, brief: p, skipClaims: true });
    expect(report.checks.brief.passed).toBe(false);
    expect(report.checks.brief.feedback[0]).toBe("structure: $: expected object, got string");
  });

  it.each(["heldout", "holdout-v1", "sealed"])("refuses a %s path before reading anything", async (word) => {
    await expect(verifyRun({ input: join(tmpdir(), word, "x"), brief: heroBrief })).rejects.toBeInstanceOf(VerifyRunUsageError);
    await expect(verifyRun({ input: heroInput, brief: join(tmpdir(), word, "b.json") })).rejects.toBeInstanceOf(VerifyRunUsageError);
  });

  it("rejects unknown and conflicting arguments", () => {
    expect(() => parseArgs(["--bogus"])).toThrow(VerifyRunUsageError);
    expect(() => parseArgs(["--claims", "x", "--skip-claims"])).toThrow(VerifyRunUsageError);
  });

  it("never touches the network", () => {
    expect(fetchCalls()).toBe(0);
  });

  it("CLI: exit 1 and NOT VERIFIED without claims; exit 2 on a refused path", () => {
    const script = join(botDir, "scripts", "verify-run.mjs");
    const r1 = spawnSync(process.execPath, [script, "--input", heroInput, "--brief", heroBrief], { encoding: "utf8" });
    expect(r1.status).toBe(1);
    expect(r1.stdout).toContain("PASS brief");
    expect(r1.stdout).toContain("NOT VERIFIED");
    const r2 = spawnSync(process.execPath, [script, "--input", join(tmpdir(), "holdout-v1"), "--brief", heroBrief], { encoding: "utf8" });
    expect(r2.status).toBe(2);
    expect(r2.stderr).toContain("refusing heldout/holdout/sealed path");
  });
});
