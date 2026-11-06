// E6 acceptance: ledger matches docs/codex/cursor-D-review.md (D6-2, D6-4, F11, F12, #66 verdict).
// Pure file reads; no network, no models, no sealed data.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../..");
const rd = (p: string) => readFileSync(resolve(root, p), "utf8");
const README = rd("docs/engineering-log.md");
const READINESS = rd("docs/release/c9-readiness.md");
const REGISTRY = rd("docs/release/acceptance-registry.md");
const VIDEO = rd("docs/submission/video-script.md");
const NOTES = rd("docs/release/video-status-notes.md");
const FOUR = [README, READINESS, REGISTRY, VIDEO].join("\n");

const STALE = [
  "8d1ca97",
  "2617b79",
  "fb4c216",
  "b383e12",
  "789ab3c",
  "7efcae0",
  "1153dd8",
  "f7a91a1",
  "c6829e3",
];

const RESTACKED = [
  "077c7d35d1fa7fd8a967f179187e137fb45831b5",
  "b63c1cf28a6973cfea1ef6cd827164553aa36e5d",
  "de50552b66c25f5c920dff50b2d5252782ec2c39",
  "1f4b74f1ece34fcaeb4a8fdee7696f6a4095040a",
  "9a3dd34e41f6d7654c9ff5b93eae175ff31a54d8",
  "7af1d4b077a68d4063546fc94553bb73aa271397",
  "7442f77538494fd35e0778d104e19aca694fc5d5",
  "d1cd7e1e6814933ead71cbd9750b5cb9a2714f28",
  "dd7c8c69244872f04515d1a20b07a2625b6dcddb",
  "1d19da07260166909d4f7d21ee82f9576923fb64",
];

describe("E6 ledger correction", () => {
  it("E6-1 no stale pre-restack SHAs or TBD-head remain in the four docs", () => {
    // G5 reconciliation labels observed run heads as historical CI; a stale
    // SHA may appear only on a line that carries the historical-CI label.
    for (const s of STALE)
      for (const line of FOUR.split("\n"))
        if (line.includes(s))
          expect(line, `stale ${s} outside historical-CI context`).toMatch(
            /historical CI/i,
          );
    expect(FOUR).not.toContain("TBD-head");
  });

  it("E6-2 restacked PR heads present; C3 old build failure fixed at de50552 (F6 closed)", () => {
    for (const sha of RESTACKED) expect(FOUR, sha).toContain(sha);
    expect(FOUR).toContain("de50552");
    expect(FOUR).toMatch(/F6[^.\n]*closed/i);
  });

  it("E6-3 per-D-row review verdicts, no blanket pass; A4-A9 reconstructed not re-verified; no D1/D2/D3/D4/D5 pass line in video script", () => {
    expect(FOUR).not.toMatch(/criteria met on the tested commit/);
    expect(FOUR).toMatch(/reconstructed; not re-verified at restacked heads/);
    expect(VIDEO).not.toMatch(/D1\/D2\/D3\/D4\/D5 pass/);
    // Per-criterion verdict language must appear (closed/partly/open).
    expect(FOUR).toMatch(/partly/);
  });

  it("E6-4 limitations match review: F4 partly open, F5 closed, F6 closed; no unconditional edit-clears-approval", () => {
    expect(FOUR).toMatch(/F4[^.\n]*(partly open|open \(partly\)|partly)/i);
    expect(FOUR).toMatch(/F5[^.\n]*closed/i);
    const line7 = README.split("\n")[6] ?? "";
    expect(line7).not.toMatch(/any edit[^.\n]*clears the approval/i);
    expect(line7).toMatch(/reload/i);
    const draftRow = VIDEO.split("\n").find((l) => /Click `#btn-copy`/.test(l)) ?? "";
    expect(draftRow).not.toMatch(/any edit[^.\n]*clears the approval/i);
    expect(NOTES).toMatch(/reload after an A->B->A edit/i);
    expect(NOTES).toMatch(/not current narration/i);
  });

  it("E6-5 E-series draft note with E1/E2/E4/E5, E3 not fixed, review link, no invented PR/SHA or founder facts", () => {
    for (const e of ["E1", "E2", "E4", "E5"]) expect(FOUR, e).toContain(e);
    expect(FOUR).toMatch(/E3[^.\n]*fixed in draft E7[^.\n]*#73[^.\n]*pending review/i);
    expect(FOUR).toContain("docs/codex/cursor-D-review.md");
    expect(FOUR).toMatch(/fail-before\/pass-after/i);
  });
});
