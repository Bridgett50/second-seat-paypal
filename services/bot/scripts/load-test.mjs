#!/usr/bin/env node
// Phase 08 load test — FIXTURE MODE ONLY, NOT PRODUCTION.
// No network beyond localhost, no new deps (node:http + perf_hooks only).
// 1. Starts the apps/web static server (dist server.js if present, else a
//    tiny static fallback serving apps/web/dist) on a free port.
// 2. Fires 500 GETs at concurrency 20 at the brief page (/briefs/demo).
// 3. Runs the brief fixture pipeline (brief:run equivalent, hero, fixture
//    mode) 20 times in-process via runBrief.
// Prints and writes eval/results/load-fixture.json + load-fixture.md.
import { get } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { createServer as createNetServer } from "node:net";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WEB_DIST_SERVER = join(ROOT, "apps/web/dist/src/server.js");
const WEB_DIST_DIR = join(ROOT, "apps/web/dist");
const HERO_INPUT = join(ROOT, "services/bot/fixtures/hero-input");
const HERO_FIXTURE = join(ROOT, "services/bot/fixtures/hero-brief.recorded.json");
const OUT_DIR = join(ROOT, "eval/results");

const N_GETS = 500;
const CONCURRENCY = 20;
const N_CLI = 20;

function pct(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}
function stats(ms) {
  const s = [...ms].sort((a, b) => a - b);
  return { n: s.length, p50: pct(s, 50), p90: pct(s, 90), max: s[s.length - 1] ?? 0 };
}
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const req = get(url, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode, ms: performance.now() - t0 }));
    });
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("timeout")));
  });
}
function freePort() {
  return new Promise((resolve, reject) => {
    const s = createNetServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      s.close(() => resolve(port));
    });
  });
}
async function startWebServer(port) {
  if (existsSync(WEB_DIST_SERVER)) {
    const child = spawn(process.execPath, [WEB_DIST_SERVER], {
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { child, mode: "dist-server" };
  }
  // Fallback: minimal static server for apps/web/dist.
  const { readFile } = await import("node:fs/promises");
  const srv = (await import("node:http")).createServer(async (req, res) => {
    if ((req.url ?? "/") === "/briefs/demo" || (req.url ?? "/") === "/briefs/demo/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<html><body>fallback brief page (fixture mode, not production)</body></html>");
      return;
    }
    try {
      const data = await readFile(join(WEB_DIST_DIR, decodeURIComponent(req.url ?? "/").replace(/^\//, "")));
      res.writeHead(200);
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  await new Promise((resolve) => srv.listen(port, "127.0.0.1", resolve));
  return { child: null, server: srv, mode: "static-fallback" };
}
async function waitReady(port, tries = 60) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const r = await httpGet(`http://127.0.0.1:${port}/briefs/demo`);
      if (r.status === 200) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("web server never became ready");
}
async function runGets(url, n, concurrency) {
  const times = [];
  let failed = 0;
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= n) return;
      try {
        const r = await httpGet(url);
        if (r.status !== 200) failed += 1;
        times.push(r.ms);
      } catch {
        failed += 1;
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { times, failed };
}

const port = await freePort();
const srv = await startWebServer(port);
await waitReady(port);
let getResult;
try {
  getResult = await runGets(`http://127.0.0.1:${port}/briefs/demo`, N_GETS, CONCURRENCY);
} finally {
  if (srv.child) srv.child.kill();
  if (srv.server) srv.server.close();
}

// Brief fixture pipeline x N_CLI (brief:run equivalent, hero, fixture mode).
process.env["EVIDENCE_BRIEF_MODE"] = "fixture";
const tmp = mkdtempSync(join(tmpdir(), "load-fixture-"));
process.env["MUSE_STATE_FILE"] = join(tmp, "state.json");
process.env["MUSE_COST_LOG_FILE"] = join(tmp, "cost-log.jsonl");
const { runBrief } = await import(join(ROOT, "services/bot/dist/src/brief/cli.js"));
const cliTimes = [];
let cliFailed = 0;
for (let i = 0; i < N_CLI; i += 1) {
  const t0 = performance.now();
  try {
    await runBrief({ inputDir: HERO_INPUT, outDir: join(tmp, `out-${i}`), fixturePath: HERO_FIXTURE });
    cliTimes.push(performance.now() - t0);
  } catch (err) {
    cliFailed += 1;
    console.error(`brief run ${i} failed: ${String(err).slice(0, 200)}`);
  }
}

const gets = stats(getResult.times);
const clis = stats(cliTimes);
const round = (v) => Math.round(v * 10) / 10;
const result = {
  label: "fixture mode, not production",
  mode: "fixture",
  serverMode: srv.mode,
  httpGets: { n: N_GETS, concurrency: CONCURRENCY, failed: getResult.failed, p50Ms: round(gets.p50), p90Ms: round(gets.p90), maxMs: round(gets.max) },
  briefCli: { n: N_CLI, failed: cliFailed, p50Ms: round(clis.p50), p90Ms: round(clis.p90), maxMs: round(clis.max) },
};
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "load-fixture.json"), `${JSON.stringify(result, null, 2)}\n`);
writeFileSync(join(OUT_DIR, "load-fixture.md"), [
  "# Load test (fixture mode, not production)",
  "",
  `Mode: fixture only, localhost, no network. Server: ${srv.mode}.`,
  "",
  `HTTP GET /briefs/demo x${N_GETS} @concurrency ${CONCURRENCY}: failed=${getResult.failed} p50=${round(gets.p50)}ms p90=${round(gets.p90)}ms max=${round(gets.max)}ms`,
  "",
  `brief fixture pipeline x${N_CLI} (hero): failed=${cliFailed} p50=${round(clis.p50)}ms p90=${round(clis.p90)}ms max=${round(clis.max)}ms`,
  "",
  "These numbers measure local fixture replay only and say nothing about production.",
  "",
].join("\n"));
console.log(JSON.stringify(result, null, 2));
