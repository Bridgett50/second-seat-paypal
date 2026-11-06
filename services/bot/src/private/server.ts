/** Read-only payload inspector: GET /briefs/demo/payload and GET /health. */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { snapshot } from "./payloadLog.js";
import { createPrivacyGate } from "./gate.js";
import { MockRedactor, liveRedactor } from "./redact.js";

/** Live only under EVIDENCE_BRIEF_MODE=live; an ambient API key alone keeps fixture. */
function inspectorMode(): "live" | "fixture" {
  return (process.env["EVIDENCE_BRIEF_MODE"] ?? "fixture") === "live" ? "live" : "fixture";
}

export function createInspectorServer() {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/briefs/demo/payload") {
      const body = JSON.stringify(snapshot());
      res.writeHead(200, { "content-type": "application/json" });
      res.end(body);
      return;
    }
    if (req.method === "GET" && url.pathname === "/health") {
      let redactor;
      try {
        const mode = inspectorMode();
        // Route through the privacy gate: live mode without GLIMMER_BASE_URL
        // throws here, before any fetch. The health probe then uses the same
        // live redactor the gate was validated with.
        redactor = mode === "live" ? liveRedactor() : new MockRedactor();
        createPrivacyGate({ mode, redactor });
      } catch {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false }));
        return;
      }
      void redactor
        .health()
        .then((h) => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(h));
        })
        .catch(() => {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: false }));
        });
      return;
    }
    res.writeHead(405, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "method not allowed" }));
  });
}
