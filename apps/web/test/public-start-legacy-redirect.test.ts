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

describe("public start legacy redirect", () => {
  it("public start: legacy /briefs/demo URLs redirect to the meeting guide without reaching the original handler", async () => {
    const port = await getFreePort();
    const env: Record<string, string | undefined> = {
      PORT: String(port),
      SECOND_SEAT_MODE: "offline",
      SECOND_SEAT_TEST_MODE: "0",
      LIVE_DEV: "0",
      SECOND_SEAT_EXPERIMENTAL_IMAGES: "0",
    };
    const server = await startPublicServer(env);
    try {
      const base = `http://127.0.0.1:${port}`;
      const paths = ["/briefs/demo", "/briefs/demo/", "/briefs/demo?x=1", "/briefs/demo/?y=2"];

      for (const p of paths) {
        const rGet = await fetch(`${base}${p}`, { redirect: "manual" });
        expect(rGet.status).toBe(302);
        expect(rGet.headers.get("location")).toBe("/meeting-room?demo=1");
        expect(rGet.headers.get("cache-control")).toBe("no-store");
        await rGet.text();

        const rHead = await fetch(`${base}${p}`, { method: "HEAD", redirect: "manual" });
        expect(rHead.status).toBe(302);
        expect(rHead.headers.get("location")).toBe("/meeting-room?demo=1");
        expect(rHead.headers.get("cache-control")).toBe("no-store");
        await rHead.text();
      }

      // Other methods on legacy paths should be 405 without reaching original handler
      const rPost = await fetch(`${base}/briefs/demo`, { method: "POST", redirect: "manual" });
      expect(rPost.status).toBe(405);
      await rPost.text();

      // Server still alive: healthz and meeting guide
      const rHealth = await fetch(`${base}/healthz`);
      expect(rHealth.status).toBe(200);
      expect(await rHealth.text()).toBe("ok");

      const rGuide = await fetch(`${base}/meeting-room?demo=1`);
      expect(rGuide.status).toBe(200);
      const guideBody = await rGuide.text();
      expect(guideBody.toLowerCase()).toContain("<html");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
