import { describe, it, expect } from "vitest";
import { createServer } from "node:http";
import * as http from "node:http";
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

function rawRequest(
  port: number,
  path: string,
  method = "GET",
  timeoutMs = 3000,
): Promise<{ status: number; headers: Record<string, string | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timeout waiting for response for ${method} ${path}`));
      req.destroy();
    }, timeoutMs);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          clearTimeout(timer);
          const body = Buffer.concat(chunks).toString("utf-8");
          const headers: Record<string, string | undefined> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (Array.isArray(v)) headers[k.toLowerCase()] = v.join(", ");
            else if (v !== undefined) headers[k.toLowerCase()] = v;
          }
          resolve({ status: res.statusCode ?? 0, headers, body });
        });
      },
    );
    req.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    req.end();
  });
}

describe("public start normalized path", () => {
  it("public start: dot-segment variants of /briefs/demo redirect via raw request paths and the server stays healthy", async () => {
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
      const paths = ["/x/../briefs/demo", "/x/%2e%2e/briefs/demo", "/briefs/./demo", "/x/../briefs/demo?x=1"];
      for (const p of paths) {
        const rGet = await rawRequest(port, p, "GET");
        expect(rGet.status).toBe(302);
        expect(rGet.headers["location"]).toBe("/meeting-room?demo=1");
        expect(rGet.headers["cache-control"]).toBe("no-store");

        const rHead = await rawRequest(port, p, "HEAD");
        expect(rHead.status).toBe(302);
        expect(rHead.headers["location"]).toBe("/meeting-room?demo=1");
        expect(rHead.headers["cache-control"]).toBe("no-store");
      }

      const rHealth = await rawRequest(port, "/healthz", "GET");
      expect(rHealth.status).toBe(200);
      expect(rHealth.body).toBe("ok");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("public start: a malformed request URL gets a safe error and the server stays healthy", async () => {
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
      const rBad = await rawRequest(port, "//", "GET");
      expect(rBad.status).toBe(400);
      expect(rBad.headers["cache-control"]).toBe("no-store");

      const rHealth = await rawRequest(port, "/healthz", "GET");
      expect(rHealth.status).toBe(200);
      expect(rHealth.body).toBe("ok");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
