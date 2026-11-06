/**
 * FR4: transcript parsing must keep citation targets when fixtures use CRLF.
 * No provider, Modal, or sealed data.
 */
import { describe, expect, it } from "vitest";
import { parseTranscript } from "../src/loadFixtures.js";
import { renderBriefPage, type Brief } from "../src/render.js";

const CRLF = "[01:32] Ana: Synthetic line.\r\n[12:41] Bo: Another line.\r\n";
const LF = "[01:32] Ana: Synthetic line.\n[12:41] Bo: Another line.\n";

function ids(text: string) {
  return parseTranscript(text).map((segment) => ({
    id: segment.id,
    speaker: segment.speaker,
    text: segment.text,
  }));
}

describe("FR4 transcript CRLF", () => {
  it("FR4-1 parses a CRLF transcript the same way as LF", () => {
    const parsed = ids(CRLF);
    expect(parsed).toEqual(ids(LF));
    expect(parsed).toEqual([
      { id: "t-01:32", speaker: "Ana", text: "Synthetic line." },
      { id: "t-12:41", speaker: "Bo", text: "Another line." },
    ]);
    expect(parsed.every((row) => !row.text.includes("\r") && !row.speaker.includes("\r"))).toBe(true);
  });

  it("FR4-2 keeps valid LF lines once and drops malformed lines", () => {
    const text = "[00:01] Ada:  keep  spaces.\n\nnot a segment\n[00:02] Bo: second\n\n[00:03] Cy: last";
    const parsed = parseTranscript(text);
    expect(parsed.map((row) => row.id)).toEqual(["t-00:01", "t-00:02", "t-00:03"]);
    expect(parsed[0]?.text).toBe("keep  spaces.");
    expect(parsed[2]?.text).toBe("last");
  });

  it("FR4-3 citation and pressure links resolve for a CRLF transcript", () => {
    const segments = parseTranscript(CRLF);
    const brief: Brief = {
      createdAt: "2026-01-01T00:00:00.000Z",
      flagged: ["e1"],
      entries: [
        {
          id: "e1",
          category: "pressure",
          text: "Synthetic pressure line.",
          speaker: null,
          flags: ["pressure"],
          citations: [
            { kind: "segment", segmentId: "t-01:32", frameId: null, region: null },
            { kind: "segment", segmentId: "t-12:41", frameId: null, region: null },
          ],
        },
      ],
    };
    const html = renderBriefPage(brief, segments, [], []);
    expect(segments.length).toBeGreaterThan(0);
    const hrefs = [...html.matchAll(/href="#([^"]+)"/g)].map((match) => match[1] ?? "");
    const targets = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1] ?? ""));
    const citationHrefs = hrefs.filter((href) => href.startsWith("seg-"));
    expect(citationHrefs.length).toBeGreaterThan(0);
    for (const href of citationHrefs) expect(targets.has(href)).toBe(true);
  });
});
