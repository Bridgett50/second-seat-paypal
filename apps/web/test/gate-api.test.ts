import { describe, expect, it } from "vitest";
import { createWebServer } from "../src/server.js";

const RAW = "Call 555-010-2202 at alice@example.com now";
const PII_BITS = ["555-010-2202", "alice@example.com"];

interface ApiResponse {
  status: number;
  json: unknown;
}

function serve(): Promise<{ base: string; close: () => void; sent: string[] }> {
  const sent: string[] = [];
  const server = createWebServer({ sender: (text: string) => void sent.push(text) });
  return new Promise((resolve) => {
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({ base: `http://localhost:${port}`, close: () => server.close(), sent });
    });
  });
}

async function post(base: string, path: string, body: unknown): Promise<ApiResponse> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as unknown };
}

describe("privacy gate API flow", () => {
  it("prepare/approve/send delivers only reviewed redacted text to the stubbed sender", async () => {
    const { base, close, sent } = await serve();
    try {
      const prepared = await post(base, "/api/prepare", { text: RAW });
      expect(prepared.status).toBe(200);
      const { runId, redactedText } = prepared.json as { runId: string; redactedText: string };
      for (const bit of PII_BITS) expect(redactedText).not.toContain(bit);

      const approved = await post(base, "/api/approve", { runId, text: redactedText });
      expect(approved.status).toBe(200);
      const { approvalToken } = approved.json as { approvalToken: string };

      const delivered = await post(base, "/api/send", { runId, approvalToken });
      expect(delivered.status).toBe(200);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toBe(redactedText);
      for (const bit of PII_BITS) expect(sent[0] ?? "").not.toContain(bit);
      expect((delivered.json as { sentText: string }).sentText).toBe(redactedText);
    } finally {
      close();
    }
  });

  it("editing after approval invalidates the token and nothing is sent", async () => {
    const { base, close, sent } = await serve();
    try {
      const prepared = await post(base, "/api/prepare", { text: RAW });
      const { runId, redactedText } = prepared.json as { runId: string; redactedText: string };
      const approved = await post(base, "/api/approve", { runId, text: redactedText });
      const { approvalToken } = approved.json as { approvalToken: string };
      const corrected = await post(base, "/api/correct", { runId, editedText: `${redactedText} (owner note)` });
      expect(corrected.status).toBe(200);
      const refused = await post(base, "/api/send", { runId, approvalToken });
      expect(refused.status).toBe(400);
      expect(sent).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("mismatched runId and missing approval are refused with nothing sent", async () => {
    const { base, close, sent } = await serve();
    try {
      const first = (await post(base, "/api/prepare", { text: RAW })).json as {
        runId: string;
        redactedText: string;
      };
      const second = (await post(base, "/api/prepare", { text: "other notes" })).json as {
        runId: string;
        redactedText: string;
      };
      const approved = await post(base, "/api/approve", { runId: first.runId, text: first.redactedText });
      const { approvalToken } = approved.json as { approvalToken: string };
      expect((await post(base, "/api/send", { runId: second.runId, approvalToken })).status).toBe(400);
      expect((await post(base, "/api/send", { runId: first.runId, approvalToken: "bogus" })).status).toBe(400);
      expect((await post(base, "/api/send", { runId: second.runId, approvalToken: "bogus" })).status).toBe(400);
      expect(sent).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("residual PII is refused with nothing sent", async () => {
    const { base, close, sent } = await serve();
    try {
      const prepared = await post(base, "/api/prepare", { text: "my ssn 123-45-6789" });
      expect(prepared.status).toBe(200);
      const { runId, redactedText } = prepared.json as { runId: string; redactedText: string };
      const approved = await post(base, "/api/approve", { runId, text: redactedText });
      const { approvalToken } = approved.json as { approvalToken: string };
      expect((await post(base, "/api/send", { runId, approvalToken })).status).toBe(400);
      expect(sent).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("raw text never reaches logs, and the page stores nothing in browser storage", async () => {
    const logged: string[] = [];
    const origLog = console.log;
    const origError = console.error;
    console.log = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
    console.error = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
    const { base, close } = await serve();
    try {
      const marker = "Zed Zebra zed.zebra@example.com";
      const prepared = await post(base, "/api/prepare", { text: `call ${marker} now` });
      expect(prepared.status).toBe(200);
      const { runId, redactedText } = prepared.json as { runId: string; redactedText: string };
      const approved = await post(base, "/api/approve", { runId, text: redactedText });
      const { approvalToken } = approved.json as { approvalToken: string };
      await post(base, "/api/send", { runId, approvalToken });
      const page = await fetch(`${base}/gate`);
      const html = await page.text();
      for (const line of logged) {
        expect(line).not.toContain("Zed Zebra");
        expect(line).not.toContain("zed.zebra@example.com");
      }
      expect(html).toContain('id="gate-preview"');
      expect(html).toContain("Approve");
      expect(html).not.toContain("localStorage");
      expect(html).not.toContain("sessionStorage");
      expect(html).not.toContain(marker);
    } finally {
      close();
      console.log = origLog;
      console.error = origError;
    }
  });
});
