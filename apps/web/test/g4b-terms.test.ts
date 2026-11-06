/**
 * G4b — Terms and capability claims match evidence.
 * Invented meeting text only. Injected fixture classifiers, offline:true.
 * No live inference, no real network (fake counting only), no paid calls.
 */
import { describe, expect, it } from "vitest";
import { createSessionStore } from "../src/session.js";
import { renderSessionPage } from "../src/render.js";

const SEG1 = "Morning sync about the quarterly plan";
const SEG2 = "This is the last chance to approve the budget";
const SEG3 = "We will also discuss the mangrove catering options";
const TEXT = `${SEG1}\n${SEG2}\n${SEG3}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cls = (labels: any) => ({ mode: "fixture" as const, classify: async () => labels });
const labelWithAsk = (ask: string) => [
  { segmentId: "seg-2", tactic: "scarcity", ask, target: "owner", span: "last chance", source: "fixture" },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function run(text: string, classifier: any) {
  const store = createSessionStore({ offline: true, pressureClassifier: classifier });
  const id = store.createSession();
  store.setTranscript(id, text);
  expect((await store.redact(id)).state).toBe("review_required");
  store.approve(id);
  const s = await store.analyze(id);
  return { store, id, s };
}

describe("G4b terms and capability claims match evidence", () => {
  it("G4-6", async () => {
    // ask only in an unrelated segment (seg-3) must not leak into the seg-2 item
    const unrelated = await run(TEXT, cls(labelWithAsk("mangrove")));
    const item = unrelated.s.pressure?.items[0];
    expect(item?.unresolvedTerm, "unrelated-term-accepted: ask from seg-3 must not resolve on a seg-2 item").toBe("");
    const html = renderSessionPage(unrelated.s);
    expect(html, "unrelated-term-accepted: rendered item must show 'term not identified'").toContain("term not identified");
    expect(html, "unrelated-term-accepted: rendered item must not present the unrelated word as the term").not.toContain("unresolved term: mangrove");
    const termLine = /<p class="pressure-term">([^<]*)<\/p>/.exec(html)?.[1] ?? "";
    expect(termLine, "unrelated-term-accepted: pressure item term line must not be the unrelated word").toBe("unresolved term: term not identified");
    // invented word nowhere in the transcript -> ""
    const invented = await run(TEXT, cls(labelWithAsk("zebraquilt")));
    expect(invented.s.pressure?.items[0]?.unresolvedTerm, "unrelated-term-accepted: invented word must not resolve").toBe("");
    // ask equal to the whole cited segment -> ""
    const whole = await run(TEXT, cls(labelWithAsk(SEG2)));
    expect(whole.s.pressure?.items[0]?.unresolvedTerm, "unrelated-term-accepted: whole cited segment must not resolve").toBe("");
    // positive control: a word inside seg-2 (not the whole segment) is shown
    const ok = await run(TEXT, cls(labelWithAsk("budget")));
    expect(ok.s.pressure?.items[0]?.unresolvedTerm, "unrelated-term-accepted: positive control word in seg-2").toBe("budget");
    expect(renderSessionPage(ok.s), "unrelated-term-accepted: positive control renders the word").toContain("budget");
  });

  it("G4-7", async () => {
    // No classifier: deterministic pattern path on invented text with a known phrase.
    const store = createSessionStore({ offline: true });
    const id = store.createSession();
    store.setTranscript(id, TEXT);
    expect((await store.redact(id)).state).toBe("review_required");
    store.approve(id);
    const s = await store.analyze(id);
    const items = s.pressure?.items ?? [];
    expect(items.length, "pattern-mislabeled: deterministic patterns must detect at least one item").toBeGreaterThan(0);
    const byId = new Map(s.segments.map((g) => [g.id, g.text]));
    for (const it0 of items) {
      expect(it0.quote.length, "pattern-mislabeled: quote must be nonempty").toBeGreaterThan(0);
      expect(byId.get(it0.segmentId) ?? "", `pattern-mislabeled: quote must sit inside cited segment ${it0.segmentId}`).toContain(it0.quote);
    }
    const html = renderSessionPage(s);
    const src = /<p id="pressure-source">([^<]*)<\/p>/.exec(html)?.[1] ?? "";
    expect(src, "pattern-mislabeled: server #pressure-source must read exactly 'deterministic pattern detection'").toBe(
      "deterministic pattern detection",
    );
    expect(html, "pattern-mislabeled: client script must contain the deterministic label").toContain("deterministic pattern detection");
    expect(html, "pattern-mislabeled: old 'pattern check' wording must be gone").not.toContain("pattern check");
  });

  it("G4-4r", async () => {
    const { s } = await run(TEXT, cls([]));
    expect(s.pressure?.status, "negative-invisible: empty labels stay valid_negative").toBe("valid_negative");
    const html = renderSessionPage(s);
    expect(html, "negative-invisible: rendered HTML must carry the negative marker").toContain('id="pressure-negative"');
    expect(html, "negative-invisible: rendered HTML must say no pressure items were found").toContain("No pressure items found");
    expect(html, "negative-invisible: client script must contain the negative marker").toContain("pressure-negative");
  });

  it("G4-8g", async () => {
    let calls = 0;
    const counting = {
      mode: "fixture" as const,
      classify: async () => {
        calls += 1;
        return [];
      },
    };
    const store = createSessionStore({ offline: true, pressureClassifier: counting });
    const id = store.createSession();
    store.setTranscript(id, TEXT);
    expect((await store.redact(id)).state).toBe("review_required");
    store.approve(id);
    let fetchCalls = 0;
    const origFetch = globalThis.fetch;
    (globalThis as unknown as { fetch: unknown }).fetch = async (...args: unknown[]) => {
      fetchCalls += 1;
      return (origFetch as (...a: never[]) => Promise<Response>)(...(args as never[]));
    };
    try {
      const s = await store.analyze(id);
      expect(calls, "one classifier invocation per analysis").toBe(1);
      renderSessionPage(s);
      expect(calls, "rendering must not re-invoke the classifier").toBe(1);
      expect(fetchCalls, "rendering must make no fetch").toBe(0);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
