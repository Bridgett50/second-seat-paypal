import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { spawn } from "node:child_process";

const ARTIFACT_URL = "__ARTIFACT_URL__";
const ARTIFACT_SHA256 = "__ARTIFACT_SHA256__";
const SOURCE_SHA = "__SOURCE_SHA__";
const LOCAL_TEST_MARKER = "__LOCAL_TEST__"; // "true" if local-test

const MAX_BYTES = 80 * 1024 * 1024;
const MAX_TOTAL_MS = 60_000;
const MAX_REDIRECTS = 3;
const MAX_ENTRIES = 2000;
const MAX_TOTAL_EXTRACTED = 100 * 1024 * 1024;
const MAX_PER_FILE = 20 * 1024 * 1024;
const ALLOWED_GITHUB_HOSTS = new Set(["objects.githubusercontent.com", "release-assets.githubusercontent.com"]);

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (ARTIFACT_URL.startsWith("__") || ARTIFACT_SHA256.startsWith("__") || SOURCE_SHA.startsWith("__")) {
  fail("bootstrap: pinned constants not filled");
}

const isLocalTest = LOCAL_TEST_MARKER === "true";

function isAllowedUrl(u) {
  try {
    const parsed = new URL(u);
    if (isLocalTest) {
      if (parsed.protocol === "file:") return true;
      if (parsed.protocol === "http:" && parsed.hostname === "127.0.0.1") return true;
      // also allow https github in local-test
      if (parsed.protocol === "https:" && parsed.hostname === "github.com" && parsed.pathname.includes("/releases/download/")) return true;
      return false;
    } else {
      if (parsed.protocol !== "https:") return false;
      if (parsed.hostname !== "github.com") return false;
      if (!parsed.pathname.includes("/releases/download/")) return false;
      return true;
    }
  } catch { return false; }
}

if (!isAllowedUrl(ARTIFACT_URL)) {
  fail("bootstrap: artifact URL not allowed");
}

function fetchWithLimits(url, redirectsLeft) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const doFetch = (currentUrl, left) => {
      if (Date.now() - start > MAX_TOTAL_MS) { reject(new Error("timeout")); return; }
      let u;
      try { u = new URL(currentUrl); } catch (e) { reject(e); return; }
      if (u.protocol === "file:") {
        // file:// handling
        let fp = decodeURIComponent(u.pathname);
        fs.readFile(fp, (err, data) => {
          if (err) reject(err);
          else {
            if (data.length > MAX_BYTES) reject(new Error("too large"));
            else resolve(data);
          }
        });
        return;
      }
      const mod = u.protocol === "https:" ? awaitImport("node:https") : awaitImport("node:http");
      mod.then(({ request }) => {
        const req = request(currentUrl, { method: "GET" }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            if (left <= 0) { reject(new Error("too many redirects")); res.resume(); return; }
            const loc = new URL(res.headers.location, currentUrl).toString();
            // validate redirect target
            try {
              const lu = new URL(loc);
              if (lu.protocol !== "https:") { reject(new Error("redirect not https")); res.resume(); return; }
              if (lu.hostname !== "github.com" && !ALLOWED_GITHUB_HOSTS.has(lu.hostname)) {
                reject(new Error("redirect host not allowed"));
                res.resume(); return;
              }
            } catch (e) { reject(e); res.resume(); return; }
            res.resume();
            doFetch(loc, left - 1);
            return;
          }
          if (res.statusCode !== 200) { reject(new Error(`download status ${res.statusCode}`)); res.resume(); return; }
          const chunks = [];
          let total = 0;
          res.on("data", (c) => {
            total += c.length;
            if (total > MAX_BYTES) { reject(new Error("too large")); req.destroy(); return; }
            if (Date.now() - start > MAX_TOTAL_MS) { reject(new Error("timeout")); req.destroy(); return; }
            chunks.push(c);
          });
          res.on("end", () => resolve(Buffer.concat(chunks)));
          res.on("error", reject);
        });
        req.on("error", reject);
        const t = setTimeout(() => { req.destroy(new Error("timeout")); }, MAX_TOTAL_MS - (Date.now() - start));
        req.on("close", () => clearTimeout(t));
        req.end();
      }).catch(reject);
    };
    doFetch(url, redirectsLeft);
  });
}
function awaitImport(s) { return import(s); }

// Validate entry name
function validateName(name) {
  if (!name || typeof name !== "string") throw new Error(`invalid entry name: ${name}`);
  if (name.includes("\0") || name.includes("\\")) throw new Error(`invalid entry name: ${name}`);
  if (path.isAbsolute(name)) throw new Error(`absolute path: ${name}`);
  const parts = name.split("/");
  for (const p of parts) {
    if (p === "..") throw new Error(`path traversal: ${name}`);
    if (p === "" && name !== "") {
      // allow trailing slash? No, we reject empty segments except we already handle
      // double slash would produce empty part
      // but simple check: no empty except leading already checked
    }
  }
  if (name.includes("..")) {
    // extra strict check already done via parts, but keep
  }
}

function gunzipWithLimit(input, limit) {
  return new Promise((resolve, reject) => {
    const gunzip = zlib.createGunzip();
    const chunks = [];
    let total = 0;
    gunzip.on("data", (c) => {
      total += c.length;
      if (total > limit) {
        const err = new Error("decompressed too large");
        gunzip.destroy(err);
        reject(err);
        return;
      }
      chunks.push(c);
    });
    gunzip.on("end", () => resolve(Buffer.concat(chunks)));
    gunzip.on("error", reject);
    gunzip.end(input);
  });
}

async function main() {
  let data;
  try {
    data = await fetchWithLimits(ARTIFACT_URL, MAX_REDIRECTS);
  } catch (e) {
    fail(`bootstrap: download failed: ${e.message}`);
  }

  const hash = crypto.createHash("sha256").update(data).digest("hex");
  if (hash !== ARTIFACT_SHA256.toLowerCase()) {
    fail("bootstrap: hash mismatch");
  }

  // Decompress with bounded output
  let decompressed;
  try {
    decompressed = await gunzipWithLimit(data, MAX_TOTAL_EXTRACTED);
  } catch (e) {
    fail(`bootstrap: decompress failed: ${e.message}`);
  }

  let archive;
  try {
    archive = JSON.parse(decompressed.toString("utf8"));
  } catch (e) {
    fail(`bootstrap: archive parse failed: ${e.message}`);
  }

  // Check manifest source SHA
  const manifestSha = archive?.manifest?.sourceSha || archive?.manifest?.source_sha || "";
  if (manifestSha !== SOURCE_SHA) {
    fail("bootstrap: manifest source sha mismatch");
  }

  const entries = archive.entries;
  if (!Array.isArray(entries)) fail("bootstrap: invalid archive entries");
  if (entries.length > MAX_ENTRIES) fail("bootstrap: too many entries");

  // Validate all entries before writing
  const seen = new Set();
  let totalBytes = 0;
  for (const e of entries) {
    if (!e || typeof e.path !== "string" || typeof e.content !== "string") fail("bootstrap: invalid entry");
    validateName(e.path);
    if (seen.has(e.path)) fail(`bootstrap: duplicate entry: ${e.path}`);
    seen.add(e.path);
    if (e.type && e.type !== "file") fail(`bootstrap: non-regular entry: ${e.path}`);
    // content is base64
    const buf = Buffer.from(e.content, "base64");
    if (buf.length > MAX_PER_FILE) fail(`bootstrap: file too large: ${e.path}`);
    totalBytes += buf.length;
    if (totalBytes > MAX_TOTAL_EXTRACTED) fail("bootstrap: total too large");
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "second-seat-"));
  try {
    for (const e of entries) {
      const buf = Buffer.from(e.content, "base64");
      const dest = path.join(tmpDir, e.path);
      const dir = path.dirname(dest);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(dest, buf);
    }
  } catch (e) {
    fail(`bootstrap: extraction failed: ${e.message}`);
  }

  const entryPath = path.join(tmpDir, "apps/web/dist/src/public-start.js");
  if (!fs.existsSync(entryPath)) fail("bootstrap: missing entry point");

  const allowEnv = {};
  for (const k of ["PORT", "PATH", "HOME", "TMPDIR", "NODE_ENV"]) {
    if (process.env[k] !== undefined) allowEnv[k] = process.env[k];
  }
  allowEnv.SECOND_SEAT_MODE = "offline";
  allowEnv.SECOND_SEAT_TEST_MODE = "0";
  allowEnv.LIVE_DEV = "0";
  allowEnv.SECOND_SEAT_EXPERIMENTAL_IMAGES = "0";

  const child = spawn(process.execPath, [entryPath], {
    env: allowEnv,
    stdio: "inherit",
  });

  child.on("error", (e) => {
    fail(`bootstrap: spawn failed: ${e.message}`);
  });

  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) {
    process.on(sig, () => {
      if (child.pid) {
        try { process.kill(child.pid, sig); } catch {}
      }
    });
  }

  child.on("exit", (code, signal) => {
    if (signal) {
      try { process.kill(process.pid, signal); } catch {}
      process.exit(1);
    } else {
      process.exit(code ?? 1);
    }
  });
}

await main();
