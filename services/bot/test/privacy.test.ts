import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MockRedactor, MOCK_LABEL, validateGlimmerOutput } from "../src/private/redact.js";
import { buildRedactedUserMessage } from "../src/brief/muse.js";
import { clearPayloadLog, logImage, snapshot } from "../src/private/payloadLog.js";
import { createInspectorServer } from "../src/private/server.js";

const thisDir = dirname(fileURLToPath(import.meta.url));
const piiDir = join(thisDir, "..", "fixtures", "pii");

describe("phase 04a privacy", () => {
  it("Spark payload contains none of the raw PII strings", async () => {
    clearPayloadLog();
    const cases = JSON.parse(readFileSync(join(piiDir, "cases.json"), "utf8")) as Array<{ file: string; entities: string[] }>;
    for (const c of cases) {
      const text = readFileSync(join(piiDir, c.file), "utf8");
      const payload = await buildRedactedUserMessage({
        meetingId: "demo",
        transcriptText: text,
        framesSidecarText: "",
        fixtureMode: true,
      });
      for (const e of c.entities) expect(payload).not.toContain(e);
    }
  });

  it("every logged image is masked (pixels differ at boxes, sha differs)", async () => {
    clearPayloadLog();
    const redactor = new MockRedactor();
    const src = readFileSync(join(piiDir, "invoice-31.png"));
    const { png, boxes, masked } = await redactor.redactImage(src, "invoice-31.png");
    expect(masked).toBe(true);
    expect(boxes.length).toBeGreaterThan(0);
    expect(Buffer.compare(png, src)).not.toBe(0);
    const entry = logImage("invoice-31.png", png, masked);
    expect(entry.masked).toBe(true);
    const snap = snapshot();
    expect(snap.images.length).toBe(1);
  });

  it("inspector endpoint lists texts and images; health returns mock label", async () => {
    clearPayloadLog();
    await buildRedactedUserMessage({ meetingId: "demo", transcriptText: "call 555-010-2202", framesSidecarText: "", fixtureMode: true });
    const redactor = new MockRedactor();
    const src = readFileSync(join(piiDir, "invoice-31.png"));
    const { png, masked } = await redactor.redactImage(src, "invoice-31.png");
    logImage("invoice-31.png", png, masked);
    const server = createInspectorServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const payload = await (await fetch(`http://127.0.0.1:${port}/briefs/demo/payload`)).json() as { texts: unknown[]; images: unknown[] };
      expect(payload.texts.length).toBeGreaterThan(0);
      expect(payload.images.length).toBe(1);
      const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json() as { ok: boolean; label: string };
      expect(health.ok).toBe(true);
      expect(health.label).toBe(MOCK_LABEL);
      const bad = await fetch(`http://127.0.0.1:${port}/briefs/demo/payload`, { method: "POST" });
      expect(bad.status).toBe(405);
    } finally {
      server.close();
    }
  });

  it("validateGlimmerOutput rejects non-substring spans", () => {
    expect(() => validateGlimmerOutput("hello world", { spans: [{ start: 0, end: 50, label: "x" }], boxes: [] })).toThrow();
  });

  it("pii-scoring fixtures: entities masked, clean text preserved", async () => {
    const scoringDir = join(thisDir, "..", "fixtures", "pii-scoring");
    const cases = JSON.parse(readFileSync(join(scoringDir, "cases.json"), "utf8")) as Array<{ file: string; entities: string[] }>;
    for (const c of cases) {
      const text = readFileSync(join(scoringDir, c.file), "utf8");
      const payload = await buildRedactedUserMessage({
        meetingId: "demo",
        transcriptText: text,
        framesSidecarText: "",
        fixtureMode: true,
      });
      for (const e of c.entities) expect(payload).not.toContain(e);
    }
    const clean01 = await buildRedactedUserMessage({
      meetingId: "demo",
      transcriptText: readFileSync(join(scoringDir, "clean-01.txt"), "utf8"),
      framesSidecarText: "",
      fixtureMode: true,
    });
    expect(clean01).toContain("quarterly menu");
    const clean02 = await buildRedactedUserMessage({
      meetingId: "demo",
      transcriptText: readFileSync(join(scoringDir, "clean-02.txt"), "utf8"),
      framesSidecarText: "",
      fixtureMode: true,
    });
    expect(clean02).toContain("harbor novel");
  });
});
