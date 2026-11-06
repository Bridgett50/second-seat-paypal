// C8 acceptance: README/submission claims match the C1–C7 implementation. Pure file reads; no network.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../..");
const rd = (p: string) => readFileSync(resolve(root, p), "utf8");
const README = rd("docs/engineering-log.md");
const VIDEO = rd("docs/submission/video-script.md");
const FIELDS = rd("docs/submission/submission-fields.md");
const RULES = rd("docs/submission/rules-check.md");
const XPOST = rd("docs/submission/x-post-draft.md");
const PLAN = rd("docs/rescue-plan.md");
const ALL = [README, VIDEO, FIELDS, RULES, XPOST].join("\n");
const sentences = (t: string) => t.split(/(?<=[.!?])\s+|\n/);

describe("C8 claims reconciliation", () => {
  it("C8-1 raw text goes to the private Glimmer redactor on Modal; owner-reviewed redacted text goes to Spark", () => {
    expect(sentences(README).some((s) => /\braw\b/i.test(s) && /Glimmer/.test(s) && /Modal/.test(s))).toBe(true);
    expect(sentences(README).some((s) => /redacted/i.test(s) && /(approved|reviewed)/i.test(s) && /Spark/.test(s))).toBe(true);
    // the old, inverted live-path claim
    expect(README).not.toMatch(/approved text is sent to the Glimmer/i);
  });
  it("C8-2 no blanket 'sends nothing'; precise vendor-send claim", () => {
    expect(ALL).not.toMatch(/sends nothing|never sends anything/i);
    expect(README).toMatch(/never sends[^.\n]*(reply|message)[^.\n]*vendor/i);
  });
  it("C8-3 criterion-level status with exact tested commit / CI evidence", () => {
    expect(README).not.toMatch(/offline verified/i);
    for (const c of ["C1", "C2", "C3", "C4", "C5", "C6", "C7"]) {
      const row = README.split("\n").find((l) => new RegExp(`^\\|\\s*${c}\\b`).test(l));
      expect(row, c).toBeTruthy();
      expect(row!, c).toMatch(new RegExp(`${c}-\\d`));
      expect(row!, c).toMatch(/github\.com\/Bridgett50\/second-seat-hackathon\/(commit\/[0-9a-f]{40}|pull\/\d+)/);
      expect(row!, c).toMatch(/actions\/runs\/\d+|CI (not run|failed|pending)/i);
    }
  });
  it("C8-4 pressure description matches the connected implementation; no competitive or intent claims", () => {
    expect(README).not.toMatch(/no pressure classifier is wired/i);
    expect(sentences(README).some((s) => /pattern/i.test(s) && /live/i.test(s) && /pressure/i.test(s))).toBe(true);
    expect(README).toMatch(/not run/i);
    expect(README).toMatch(/failed/i);
    expect(ALL).not.toMatch(/other tools|competitor|who is pressuring you|vendors?[^.\n]*on purpose/i);
  });
  it("C8-5 work deadline and billed allocation described separately; no hard dollar cap claim", () => {
    expect(README).toMatch(/work deadline/i);
    expect(sentences(README).some((s) => /billed/i.test(s) && /allocation/i.test(s))).toBe(true);
    expect(ALL).not.toMatch(/capped spend|hard (dollar |spend |\$)?cap/i);
  });
  it("C8-6 A1–A3 criteria labelled reconstructed, not verbatim", () => {
    expect(PLAN.split("\n")[0]).not.toMatch(/verbatim/i);
    expect(PLAN).toMatch(/reconstructed/i);
    for (const a of ["A1", "A2", "A3"]) {
      const row = README.split("\n").find((l) => new RegExp(`^\\|\\s*${a}\\b`).test(l))!;
      expect(row, a).toMatch(/reconstructed/i);
    }
  });
  it("C8-7 video shows the pressure-review action before Copy, one meeting, accurate mode labels", () => {
    const rows = VIDEO.split("\n").filter((l) => /^\| \d:\d\d/.test(l));
    const review = rows.findIndex((r) => /\.pressure-review/.test(r) && /(check|tick|click)/i.test(r));
    const copy = rows.findIndex((r) => /Click `#btn-copy`/.test(r));
    expect(review).toBeGreaterThanOrEqual(0);
    expect(copy).toBeGreaterThan(review);
    expect(VIDEO).toMatch(/ONE meeting/);
    expect(rows.join("\n")).not.toMatch(/live analysis/i);
    expect(rd("docs/release/video-status-notes.md")).not.toMatch(/live analysis/i);
  });
  it("C8-8 founder story is supplied; user observations and video stay pending", () => {
    expect(README).toMatch(/Founder story: done/);
    expect(README).toMatch(/User observations: PENDING/);
    expect(README).toMatch(/Video URLs: PENDING/);
    expect(ALL).not.toMatch(/saved (me|us|them) \$|customers (said|told)|market validation (shows|proves)/i);
  });
  it("C8-9 historical failures visible; fixture latency not used as live evidence", () => {
    for (const s of ["6/8", "18/29", "18/39", "complete: false", "invalid JSON"]) expect(README).toContain(s);
    for (const t of [README, VIDEO]) {
      for (const s of sentences(t).filter((x) => /p50/.test(x))) {
        expect(s, s).toMatch(/fixture/i);
        expect(s, s).not.toMatch(/live (model )?performance/i);
      }
    }
  });
});
