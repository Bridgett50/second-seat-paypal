import { pathToFileURL } from "node:url";
import type { Server } from "node:http";
import { createWebServer } from "./server.js";

export const PUBLIC_BIND_HOST = "0.0.0.0";

export type EnvRecord = Record<string, string | undefined>;

export function validatePublicStartEnv(env: EnvRecord): string[] {
  const errors: string[] = [];

  // PORT must be present and valid TCP port
  const portRaw = env["PORT"];
  if (portRaw === undefined || portRaw === "") {
    errors.push("Refused: PORT is required");
  } else {
    const n = Number(portRaw);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      errors.push("Refused: PORT must be a valid TCP port number");
    }
  }

  // SECOND_SEAT_MODE must be offline
  if (env["SECOND_SEAT_MODE"] !== "offline") {
    errors.push("Refused: SECOND_SEAT_MODE must be offline");
  }

  // Each of these must be unset or "0"
  for (const key of ["SECOND_SEAT_TEST_MODE", "LIVE_DEV", "SECOND_SEAT_EXPERIMENTAL_IMAGES"] as const) {
    const v = env[key];
    if (v !== undefined && v !== "0") {
      errors.push(`Refused: ${key} must be unset or 0`);
    }
  }

  return errors;
}

/** Parse PORT after validation; caller should have validated first. */
function parsePort(env: EnvRecord): number {
  return Number(env["PORT"]);
}

export function startPublicServer(env: EnvRecord = process.env as EnvRecord): Promise<Server> {
  const problems = validatePublicStartEnv(env);
  // Also validate the real process environment for safety flags that server.ts
  // reads directly. A safe `env` object must not bypass unsafe process.env.
  const realEnv = process.env as EnvRecord;
  if (env !== realEnv) {
    // process.env selects anything other than offline (unset or offline is OK) — refuse before server creation
    const mode = realEnv["SECOND_SEAT_MODE"];
    if (mode !== undefined && mode !== "" && mode !== "offline") {
      const msg = "Refused: SECOND_SEAT_MODE must be offline";
      if (!problems.includes(msg)) problems.push(msg);
    }
    const realProblems = validatePublicStartEnv(realEnv);
    for (const p of realProblems) {
      // PORT is sourced from `env`, not process.env; other safety flags come from process.env
      if (p.includes("PORT")) continue;
      if (p.includes("SECOND_SEAT_MODE")) continue;
      if (!problems.includes(p)) problems.push(p);
    }
  }
  if (problems.length > 0) {
    const msg = problems.join("; ");
    throw new Error(msg);
  }
  const port = parsePort(env);
  const server = createWebServer();
  // Intercept /healthz before the offline app sees it.
  const origListeners = server.listeners("request") as ((...a: unknown[]) => void)[];
  server.removeAllListeners("request");
  server.on("request", (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => {
    let pathname: string;
    try {
      pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    } catch {
      const method = (req.method ?? "GET").toUpperCase();
      res.writeHead(400, { "cache-control": "no-store" });
      if (method === "HEAD") {
        res.end();
      } else {
        res.end("Bad Request");
      }
      return;
    }
    if (pathname === "/briefs/demo" || pathname === "/briefs/demo/") {
      const method = (req.method ?? "GET").toUpperCase();
      if (method === "GET" || method === "HEAD") {
        res.writeHead(302, {
          Location: "/meeting-room?demo=1",
          "cache-control": "no-store",
        });
        if (method === "HEAD") {
          res.end();
        } else {
          res.end("");
        }
        return;
      }
      res.writeHead(405, { "cache-control": "no-store" });
      res.end();
      return;
    }
    if (pathname === "/healthz") {
      const method = (req.method ?? "GET").toUpperCase();
      if (method !== "GET" && method !== "HEAD") {
        res.writeHead(405, { "cache-control": "no-store" });
        res.end();
        return;
      }
      const body = "ok";
      res.writeHead(200, {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "content-length": String(Buffer.byteLength(body)),
      });
      if (method === "HEAD") {
        res.end();
      } else {
        res.end(body);
      }
      return;
    }
    for (const fn of origListeners) {
      (fn as unknown as (a: typeof req, b: typeof res) => void)(req, res);
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, PUBLIC_BIND_HOST, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  startPublicServer(process.env as EnvRecord)
    .then((server) => {
      const addr = server.address() as { port: number } | null;
      const port = addr?.port ?? Number(process.env["PORT"]);
      console.log(`public demo on http://${PUBLIC_BIND_HOST}:${port}/meeting-room?demo=1`);
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      for (const line of msg.split("; ")) console.error(line.trim());
      process.exit(1);
    });
}
