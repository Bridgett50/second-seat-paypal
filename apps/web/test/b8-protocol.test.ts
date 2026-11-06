// B8 acceptance: buyer-evidence protocol + template are honest and complete. File reads only.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../..");
const P = (f: string) => resolve(root, "docs/buyer-evidence", f);
const rd = (f: string) => (existsSync(P(f)) ? readFileSync(P(f), "utf8") : "");
const PROTO = rd("protocol.md");
const TPL = rd("evidence-template.md");
const SCEN = rd("scenarios.md");

describe("B8 buyer-evidence protocol", () => {
  it("B8-1 made-up, nonsealed scenarios only", () => {
    expect(SCEN).toMatch(/made-up|fictional/i);
    expect(SCEN).toMatch(/not (from|drawn from)[^\n]*(sealed|held-?out)/i);
    expect((SCEN.match(/^## Scenario /gm) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(SCEN + PROTO).not.toMatch(/eval\/heldout|holdout-v1|heldout-sealed|\.sha256/);
  });
  it("B8-2 intended buyer and purchasing/review task defined", () => {
    expect(PROTO).toMatch(/^## Intended buyer/m);
    expect(PROTO).toMatch(/^## Task/m);
  });
  it("B8-3 baseline vs assistant on equivalent tasks, rotated order", () => {
    expect(PROTO).toMatch(/existing process/i);
    expect(PROTO).toMatch(/equivalent/i);
    expect(PROTO).toMatch(/rotat|counterbalanc/i);
  });
  it("B8-4 records time, factual mistakes, missed terms, confusion, use-again", () => {
    for (const k of [/time/i, /factual mistake/i, /missed term/i, /confusion/i, /use (it )?again/i]) expect(TPL).toMatch(k);
  });
  it("B8-5 negative observations and failures captured", () => {
    expect(TPL).toMatch(/^#+ .*(negative|failure)/im);
  });
  it("B8-6 facts, quotes, founder interpretation separated", () => {
    expect(TPL).toMatch(/^#+ Observed facts/m);
    expect(TPL).toMatch(/^#+ Participant quotes/m);
    expect(TPL).toMatch(/^#+ Founder interpretation/m);
  });
  it("B8-7 no invented observations/quotes/savings/WTP; template is empty", () => {
    expect(PROTO).toMatch(/do not invent/i);
    expect(TPL).not.toMatch(/"[^"]{12,}"/); // no pre-filled quotes
    expect(TPL + PROTO).not.toMatch(/\$\d|\d+\s?%\s*(faster|saving)|saved \d/i);
    expect(PROTO).toMatch(/Bridgett[^\n]*(recruit|observ)/);
    expect(PROTO).toMatch(/no automatic contact|not contact[^\n]*automatic/i);
  });
  it("B8-8 small usability sample labelled; no market validation claim", () => {
    expect(PROTO).toMatch(/small usability sample/i);
    expect(PROTO + TPL).toMatch(/not market validation/i);
  });
});
