import { describe, it, expect } from "vitest";
import { createServer } from "node:http";
import { startPublicServer } from "../src/public-start.js";

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, () => {
      const addr = s.address() as { port: number };
      const port = addr.port;
      s.close((err) => (err ? reject(err) : resolve(port)));
    });
    s.on("error", reject);
  });
}

describe("public start healthz", () => {
  it("public start: /healthz is side-effect-free and ready once listening", async () => {
    const port = await getFreePort();
    const env = {
      PORT: String(port),
      SECOND_SEAT_MODE: "offline",
      SECOND_SEAT_TEST_MODE: "0",
      LIVE_DEV: "0",
      SECOND_SEAT_EXPERIMENTAL_IMAGES: "0",
    };
    const server = await startPublicServer(env as Record<string, string | undefined>);
    try {
      const base = `http://127.0.0.1:${port}`;

      // GET /healthz returns 200 with no-store and no set-cookie
      const r1 = await fetch(`${base}/healthz`);
      expect(r1.status).toBe(200);
      expect(r1.headers.get("cache-control")).toBe("no-store");
      expect(r1.headers.get("set-cookie")).toBeNull();
      const body1 = await r1.text();
      expect(body1.length).toBeGreaterThan(0);

      // several repeated probes give same answer and never set a cookie
      for (let i = 0; i < 3; i++) {
        const r = await fetch(`${base}/healthz`);
        expect(r.status).toBe(200);
        expect(r.headers.get("cache-control")).toBe("no-store");
        expect(r.headers.get("set-cookie")).toBeNull();
        const b = await r.text();
        expect(b).toBe(body1);
      }

      // POST to /healthz gets 405
      const rPost = await fetch(`${base}/healthz`, { method: "POST" });
      expect(rPost.status).toBe(405);
      await rPost.text();

      // request to some other path is not answered with the readiness body
      const rOther = await fetch(`${base}/some-other-path-xyz`);
      const otherBody = await rOther.text();
      expect(otherBody).not.toBe(body1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
