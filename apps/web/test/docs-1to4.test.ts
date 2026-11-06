import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../..");
const rd = (p: string) => readFileSync(resolve(root, p), "utf8");

const A1 = "Changes were reviewed by independent AI reviewers and checked by automated tests, with the results documented in the repo.";
const A2 = "The meeting room you just saw is a scripted demo with no model calls. Meta's Glimmer and Spark run in a separate transcript workflow.";
const A3 = "Muse Code wrote most of the code. Cursor did a repair pass, I directed the work and made hand edits, and other AI tools reviewed it. PROVENANCE.md records who did what.";
const A4 = "Pre-existing: the idea, an earlier prototype, and my AI-self portrait. Built during the event (Oct 26–Nov 4): all the code, partly in a companion repo and brought over on Oct 30.";

const banned = [
  "Every change was independently reviewed and tested",
  "everything in this repo",
  "Muse Code wrote it. Opus reviewed it.",
  "Do not change a word",
  "127 commits",
  "authored 142",
  "51 commits",
  "196 commits",
];

function parseSlots(text: string) {
  const re = /\[(\d+):(\d+)-(\d+):(\d+)\]/g;
  const slots: { start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    slots.push({ start: parseInt(m[1]!) * 60 + parseInt(m[2]!), end: parseInt(m[3]!) * 60 + parseInt(m[4]!) });
  }
  return slots;
}

describe("docs honesty edits 1-4", () => {
  it("approved texts present where required", () => {
    const readme = rd("README.md");
    const rec = rd("RECORDING_SCRIPT.md");
    const sub = rd("docs/submission/video-script.md");
    const fields = rd("docs/submission/submission-fields.md");
    const eng = rd("docs/engineering-log.md");
    const prov = rd("PROVENANCE.md");
    // A1
    expect(readme).toContain(A1);
    expect(rec).toContain(A1);
    expect(sub).toContain(A1);
    // A2
    expect(rec).toContain(A2);
    expect(sub).toContain(A2);
    // A3
    expect(rec).toContain(A3);
    expect(sub).toContain(A3);
    expect(readme).toContain(A3);
    expect(fields).toContain(A3);
    expect(eng).toContain(A3);
    // A4
    expect(readme.split("\n")[0]).toBe(A4);
    expect(eng.split("\n")[0]).toBe(A4);
    expect(fields).toContain(A4);
    expect(rec).toContain(A4);
    expect(sub).toContain(A4);
    // revised phrase
    expect(rec).toContain("revised Nov 1, 2026 with owner approval");
    expect(sub).toContain("revised Nov 1, 2026 with owner approval");
    // PR #139
    expect(prov).toContain("PR #139");
    expect(prov).toContain("Oct 30, 2026");
    // scripts identical lines 3-21
    const recLines = rec.split("\n").slice(2, 21);
    const subLines = sub.split("\n").slice(2, 21);
    expect(recLines).toEqual(subLines);
  });

  it("slot labels contiguous and end before 3:00", () => {
    for (const p of ["RECORDING_SCRIPT.md", "docs/submission/video-script.md"]) {
      const text = rd(p);
      const slots = parseSlots(text);
      expect(slots.length).toBe(5);
      expect(slots[0]!.start).toBe(0);
      for (let i = 1; i < slots.length; i++) expect(slots[i]!.start).toBe(slots[i - 1]!.end);
      expect(slots[slots.length - 1]!.end).toBeLessThanOrEqual(180);
    }
  });

  it("banned stale phrases absent", () => {
    const files = [
      "README.md",
      "RECORDING_SCRIPT.md",
      "docs/submission/video-script.md",
      "docs/submission/submission-fields.md",
      "docs/engineering-log.md",
      "docs/release/final-repair-acceptance.md",
      "PROVENANCE.md",
    ];
    for (const f of files) {
      const c = rd(f);
      for (const b of banned) expect(c).not.toContain(b);
    }
  });

  it("PROVENANCE has no empty Session B heading", () => {
    const prov = rd("PROVENANCE.md");
    const lines = prov.split("\n");
    expect(lines.filter((l) => l === "## Session B").length).toBe(0);
    expect(lines.filter((l) => l === "## Session B: meeting room page (written fresh in the event repo, Oct 29, 2026)").length).toBe(1);
  });

  it("partner line and run label wording", () => {
    const docs = [
      "docs/submission/submission-fields.md",
      "docs/submission/rules-check.md",
      "NEW_DURING_HACKATHON.md",
      "docs/release/acceptance-registry.md",
      "docs/release/live-e2e-plan.md",
      "docs/models.md",
      "docs/release/b10-demo-freeze-prep.md",
    ];
    const partnerText = "Partner prize: none selected. Partner providers used: Baseten (Muse Code), Modal (Glimmer, Live mode only).";
    const runLabel = "written run summary (owner-attested, synthetic data), not a screen recording";
    const kept = "recorded runs are fine if labeled";
    for (const p of docs) {
      const c = rd(p);
      expect(c.toLowerCase()).not.toContain("partner none");
      const stripped = c.split(kept).join("");
      expect(stripped.toLowerCase()).not.toContain("recorded run");
    }
    expect(rd("docs/submission/submission-fields.md")).toContain(partnerText);
    expect(rd("docs/submission/submission-fields.md")).toContain(runLabel);
    expect(rd("docs/submission/rules-check.md")).toContain(runLabel);
    expect(rd("docs/release/video-status-notes.md")).toContain(runLabel);
  });

  it("live clip is not called a written run summary", () => {
    const noClip = "No live-run clip is planned for the video; the video shows only the scripted offline meeting room.";
    const runLabel2 = "documented as a written run summary (owner-attested, synthetic data), not a screen recording";
    const clipSummaryRe = /clip[^.\n]*written run summary/i;
    for (const p of ["docs/submission/rules-check.md", "docs/release/b10-demo-freeze-prep.md"] as const) {
      const c = rd(p);
      expect(c).not.toMatch(clipSummaryRe);
      expect(c).toContain(noClip);
      expect(c).toContain(runLabel2);
    }
  });

  it("verbatim statuses paragraph restored with a dated correction after it", () => {
    const ORIGINAL = '- Statuses spoken accurately, per [docs/release/acceptance-registry.md]: A1–A9 merged (A1–A3 criteria reconstructed, not verbatim); C1–C7 criteria with per-criterion outcomes on the tested commits, including pending C1-9, C2-7, C3-7/C3-8, C4-7/C4-8/C4-9/C4-11, C6-4/C6-7 and partial pressure/model rows; C8 docs checks; C9 prep only with execution blocked; D-series review verdicts per [docs/release/acceptance-registry.md]: D1-1 partly, D1-2 closed, D1-3 closed, D1-4 closed, D1-5 closed; D2-1 closed, D2-2 partly, D2-3 closed, D2-4 closed, D2-5 closed, D2-6 partly; D3-1 closed, D3-2 partly, D3-3 partly, D3-4 open, D3-5 partly; D4-1 closed, D4-2 partly, D4-3 partly, D4-4 open, D4-5 closed, D4-6 partly; D5-1 partly, D5-2 closed, D5-3 partly, D5-4 partly, D5-5 partly; D6-1 closed, D6-2 open, D6-3 closed, D6-4 open, D6-5 closed; live end-to-end passed 3/3 on Oct 28, 2026 at 0365fdb; rehearsals passed at 8c00c32 and on the November 15 fix (#116); verification is wired into the session (#113); Persuasion Shield: experimental layer; on dev set the pattern layer caught 14/14 and Spark added no extra catches [eval/resistance-table.mjs]; held-out run Nov 2 will test it (#114/#115); the public link is demo mode with recorded examples; the live run was recorded and must be labeled as a recorded run; partner none. Video URL and user observations stay PENDING. Founder story: done. Never say blanket "criteria met."';
    const text = rd("docs/release/video-status-notes.md");
    const lines = text.split("\n");
    const line14 = lines[14];
    const line12 = lines[12];
    expect(line14).toBe(ORIGINAL);
    expect(line12).toBe('## Removed "statuses spoken" paragraph, verbatim');
    let nextNonEmpty: string | undefined = undefined;
    for (let i = 15; i < lines.length; i++) {
      const v = lines[i];
      if (v !== undefined && v !== "") {
        nextNonEmpty = v;
        break;
      }
    }
    expect(nextNonEmpty).toBeDefined();
    const corr = nextNonEmpty ?? "";
    expect(corr.startsWith("- Correction (Nov 1, 2026")).toBe(true);
    expect(corr).toContain("written run summary (owner-attested, synthetic data), not a screen recording");
    expect(corr).toContain("Partner prize: none selected. Partner providers used: Baseten (Muse Code), Modal (Glimmer, Live mode only).");
  });

  it('README and rules-check describe the meeting room demo and the transcript workflow', () => {
    const readme = rd('README.md');
    const rules = rd('docs/submission/rules-check.md');
    expect(readme).toContain('Second Seat works in two places: during a meeting, a scripted offline twin sits in the second seat on synthetic data while you guide it or take over, with no model calls; after the meeting, the transcript workflow below turns your pasted meeting text into a cited brief.');
    expect(readme).toContain('In the meeting room demo, Send works only on a local server started in test mode, where it goes to a test (fake) transport after you approve the exact package; on the public demo site, Send is refused and the evidence record shows the package as unsent.');
    expect(readme).toContain('The meeting room twin is a scripted demonstration on synthetic data: it calls no model, and its Send reaches the fake transport only in local test mode and is refused on the public site (see "Meeting room demo walkthrough").');
    expect(readme).toContain('- *Auto-sending replies.* Rejected. In the transcript workflow (`/session`), Copy is the only exit, and only after you approve the exact draft; in the meeting room demo, Send reaches only a test (fake) transport in local test mode and is refused on the public site.');
    expect(readme).not.toContain('sits next to you after the call');
    expect(readme).not.toContain('- *Auto-sending replies.* Rejected. Copy is the only exit, and only after you approve the exact draft.');
    expect(rules).toContain('- [ ] No banned category. This is a meeting-time AI twin demo (a scripted offline meeting room with no model calls) plus a transcript review workflow, not any of the excluded builds.');
    expect(rules).not.toContain('after-call review tool');
  });
});
