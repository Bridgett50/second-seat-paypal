import { describe, it, expect } from "vitest";
import { createServer } from "node:http";
import { startPublicServer } from "../src/public-start.js";

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, () => {
      const addr = s.address() as { port: number };
      const port = addr.port;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

describe("public start: a safe env object cannot bypass unsafe process settings", () => {
  it("public start: a safe env object cannot bypass unsafe process settings", async () => {
    const cases: Array<{ key: string; value: string }> = [
      { key: "SECOND_SEAT_TEST_MODE", value: "1" },
      { key: "LIVE_DEV", value: "1" },
      { key: "SECOND_SEAT_EXPERIMENTAL_IMAGES", value: "1" },
      { key: "SECOND_SEAT_MODE", value: "live" },
    ];

    for (const c of cases) {
      const port = await getFreePort();
      const safeEnv: Record<string, string | undefined> = {
        PORT: String(port),
        SECOND_SEAT_MODE: "offline",
      };

      const saved = process.env[c.key];
      const had = Object.prototype.hasOwnProperty.call(process.env, c.key);
      process.env[c.key] = c.value;
      let threw = false;
      let message = "";
      try {
        const server = await startPublicServer(safeEnv);
        // If it started, it should not have — close and fail
        await new Promise<void>((r) => server.close(() => r()));
      } catch (e) {
        threw = true;
        message = e instanceof Error ? e.message : String(e);
      } finally {
        if (had) process.env[c.key] = saved as string;
        else delete process.env[c.key];
      }

      expect(threw, `expected refusal when process.env ${c.key}=${c.value}`).toBe(true);
      expect(message).toContain(c.key);
      expect(message).not.toContain(c.value);
      // Nothing should be listening on that port
      await expect(
        fetch(`http://127.0.0.1:${port}/gate`, { signal: AbortSignal.timeout(1000) }).then((r) => r.status),
      ).rejects.toBeDefined();
    }
    // one-line summary
    console.log("public-start-env: safe env cannot bypass unsafe process settings — 4/4 refused");
  });
});
