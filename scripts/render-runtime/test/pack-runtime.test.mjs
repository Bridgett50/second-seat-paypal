import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PACK_RUNTIME = fileURLToPath(new URL("../pack-runtime.mjs", import.meta.url));
const SHA40 = "a".repeat(40);
const SHA40_B = "b".repeat(40);

function mkFakeRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fake-repo-"));
  function write(rel, content) {
    const abs = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  write("apps/web/package.json", JSON.stringify({ name: "@second-seat/web" }));
  write("apps/web/dist/src/public-start.js", "console.log('start');");
  write("apps/web/dist/src/index.js", "export {} // apps web index");
  write("apps/web/dist/src/render.js", "export {} // render");
  write("packages/core/package.json", JSON.stringify({ name: "@second-seat/core" }));
  write("packages/core/dist/src/index.js", "export {} // core index");
  write("packages/core/dist/src/types.js", "export {} // core types");
  write("services/bot/package.json", JSON.stringify({ name: "@second-seat/bot" }));
  write("services/bot/dist/src/index.js", "export {} // bot index");
  write("services/bot/dist/src/t2-room.js", "export {} // t2-room");

  // parser store layout: node_modules/.pnpm/@meta-sam+parser@0.1.0/node_modules/@meta-sam/parser
  const storeParser = path.join(tmp, "node_modules/.pnpm/@meta-sam+parser@0.1.0/node_modules/@meta-sam/parser");
  fs.mkdirSync(path.join(storeParser, "dist"), { recursive: true });
  fs.writeFileSync(path.join(storeParser, "package.json"), JSON.stringify({ name: "@meta-sam/parser" }));
  fs.writeFileSync(path.join(storeParser, "dist/index.js"), "export {} // parser index");
  fs.writeFileSync(path.join(storeParser, "dist/types.js"), "export {} // parser types");
  // Also ensure pnpm structure ancestors exist as real dirs (already via mkdir -p)
  // Parser link with RELATIVE value like real repo: from services/bot/node_modules/@meta-sam/parser -> ../../../../node_modules/.pnpm/@meta-sam+parser@0.1.0/node_modules/@meta-sam/parser
  const linkDir = path.join(tmp, "services/bot/node_modules/@meta-sam");
  fs.mkdirSync(linkDir, { recursive: true });
  const relativeTarget = "../../../../node_modules/.pnpm/@meta-sam+parser@0.1.0/node_modules/@meta-sam/parser";
  fs.symlinkSync(relativeTarget, path.join(linkDir, "parser"));

  // decoys
  write("apps/web/dist/src/ignore.js.map", "{}");
  write("apps/web/dist/src/ignore.d.ts", "declare");
  write("apps/web/dist/test/x.test.js", "test");
  write("apps/web/src/should-not-appear.js", "bad");
  write("packages/core/dist/test/x.test.js", "bad");
  write("packages/core/fixtures/data.json", "{}");
  write("services/bot/dist/src/ignore.test.js", "bad");
  write("services/bot/dist/src/fixtures/a.js", "bad");
  write(path.join(tmp, ".env"), "SECRET=1");
  fs.mkdirSync(path.join(tmp, ".git"), { recursive: true });
  fs.writeFileSync(path.join(tmp, ".git/config"), "");
  const sealedDir = path.join(tmp, "sealed");
  fs.mkdirSync(sealedDir, { recursive: true });
  const sentinel = path.join(sealedDir, "sentinel.txt");
  fs.writeFileSync(sentinel, "DO_NOT_READ");
  try { fs.chmodSync(sentinel, 0o000); } catch {}
  // secret file inside parser dist should be excluded by name filter
  fs.writeFileSync(path.join(storeParser, "dist/secret-should-exclude.js"), "bad");
  fs.mkdirSync(path.join(tmp, "holdout-v1"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "holdout-v1/x.txt"), "nope");

  return { tmp, sentinel, sealedDir, storeParser };
}

function cleanup(dir) {
  try {
    const sentinel = path.join(dir, "sealed/sentinel.txt");
    try { fs.chmodSync(sentinel, 0o600); } catch {}
    // remove FIFOs if any
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
}

function tryMakeFifo(p) {
  try {
    const r = spawnSync("mkfifo", [p]);
    if (r.status === 0) return true;
  } catch {}
  return false;
}

// Helper to map archive path back to original source absolute for content comparison
function archiveToSourceRel(archivePath) {
  if (archivePath === "apps/web/package.json") return "apps/web/package.json";
  if (archivePath.startsWith("apps/web/dist/src/")) return `apps/web/dist/src/${archivePath.slice("apps/web/dist/src/".length)}`;
  if (archivePath === "node_modules/@second-seat/core/package.json") return "packages/core/package.json";
  if (archivePath.startsWith("node_modules/@second-seat/core/dist/src/")) return `packages/core/dist/src/${archivePath.slice("node_modules/@second-seat/core/dist/src/".length)}`;
  if (archivePath === "node_modules/@second-seat/bot/package.json") return "services/bot/package.json";
  if (archivePath.startsWith("node_modules/@second-seat/bot/dist/src/")) return `services/bot/dist/src/${archivePath.slice("node_modules/@second-seat/bot/dist/src/".length)}`;
  if (archivePath === "node_modules/@meta-sam/parser/package.json") return "node_modules/.pnpm/@meta-sam+parser@0.1.0/node_modules/@meta-sam/parser/package.json";
  if (archivePath.startsWith("node_modules/@meta-sam/parser/dist/")) return `node_modules/.pnpm/@meta-sam+parser@0.1.0/node_modules/@meta-sam/parser/dist/${archivePath.slice("node_modules/@meta-sam/parser/dist/".length)}`;
  return null;
}

test("pack: plan includes only allowlisted runtime paths", () => {
  const { tmp } = mkFakeRepo();
  try {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "pack-out-"));
    try {
      const r = spawnSync(process.execPath, [PACK_RUNTIME, "--repo", tmp, "--out", outDir, "--source-sha", SHA40, "--plan-only"], { encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      const planPaths = JSON.parse(r.stdout.trim());
      const expected = [
        "apps/web/dist/src/index.js",
        "apps/web/dist/src/public-start.js",
        "apps/web/dist/src/render.js",
        "apps/web/package.json",
        "node_modules/@meta-sam/parser/dist/index.js",
        "node_modules/@meta-sam/parser/dist/types.js",
        "node_modules/@meta-sam/parser/package.json",
        "node_modules/@second-seat/bot/dist/src/index.js",
        "node_modules/@second-seat/bot/dist/src/t2-room.js",
        "node_modules/@second-seat/bot/package.json",
        "node_modules/@second-seat/core/dist/src/index.js",
        "node_modules/@second-seat/core/dist/src/types.js",
        "node_modules/@second-seat/core/package.json",
      ].sort();
      assert.deepEqual(planPaths, expected);

      const r2 = spawnSync(process.execPath, [PACK_RUNTIME, "--repo", tmp, "--out", outDir, "--source-sha", SHA40], { encoding: "utf8" });
      assert.equal(r2.status, 0, r2.stderr);
      const info = JSON.parse(r2.stdout.trim());
      assert.equal(info.sourceSha, SHA40);
      assert.deepEqual(info.paths, expected);
      assert.match(info.name, /^second-seat-runtime-[0-9a-f]{12}\.json\.gz$/);
      assert.ok(info.size > 0);
      assert.match(info.sha256, /^[0-9a-f]{64}$/);

      const artifactPath = path.join(outDir, info.name);
      const gz = fs.readFileSync(artifactPath);
      const hash = crypto.createHash("sha256").update(gz).digest("hex");
      assert.equal(hash, info.sha256);

      const decompressed = zlib.gunzipSync(gz);
      const parsed = JSON.parse(decompressed.toString("utf8"));
      assert.equal(parsed.manifest.sourceSha, SHA40);
      assert.deepEqual(parsed.manifest.plan, expected);
      assert.equal(parsed.entries.length, expected.length);
      const entryMap = new Map(parsed.entries.map((e) => [e.path, e]));
      for (const p of expected) {
        const e = entryMap.get(p);
        assert.ok(e, `missing entry ${p}`);
        assert.equal(e.type, "file");
        const buf = Buffer.from(e.content, "base64");
        const sourceRel = archiveToSourceRel(p);
        assert.ok(sourceRel, `no source mapping for ${p}`);
        const orig = fs.readFileSync(path.join(tmp, sourceRel));
        assert.ok(buf.equals(orig), `content mismatch for ${p}: expected ${orig.toString("utf8").slice(0,80)} got ${buf.toString("utf8").slice(0,80)}`);
        // also verify sha256 per entry matches
        const h1 = crypto.createHash("sha256").update(buf).digest("hex");
        const h2 = crypto.createHash("sha256").update(orig).digest("hex");
        assert.equal(h1, h2);
      }
      for (const bad of ["apps/web/dist/src/ignore.js.map", "apps/web/dist/src/ignore.d.ts", "apps/web/dist/test/x.test.js"]) {
        assert.ok(!planPaths.includes(bad));
      }
      fs.rmSync(outDir, { recursive: true, force: true });
    } finally {}
  } finally { cleanup(tmp); }
});

test("pack: symlink to a fake sealed dir is not followed", () => {
  const { tmp, sealedDir, sentinel } = mkFakeRepo();
  try {
    // NON-excluded name symlink inside allowlisted dir pointing to sealed dir
    const linkPath = path.join(tmp, "apps/web/dist/src/helper-link");
    fs.symlinkSync(sealedDir, linkPath);
    const rootLink = path.join(tmp, "root-link");
    try { fs.symlinkSync(sealedDir, rootLink); } catch {}

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "pack-out2-"));
    try {
      const r = spawnSync(process.execPath, [PACK_RUNTIME, "--repo", tmp, "--out", outDir, "--source-sha", SHA40], { encoding: "utf8" });
      assert.notEqual(r.status, 0);
      const files = fs.readdirSync(outDir);
      assert.equal(files.length, 0);
      // stderr must name the link path, not sentinel contents
      const combined = (r.stderr || "") + (r.stdout || "");
      assert.match(combined, /symlink/i);
      assert.match(combined, /helper-link/);
      assert.ok(!combined.includes("DO_NOT_READ"), "should not read sentinel contents");

      const r2 = spawnSync(process.execPath, [PACK_RUNTIME, "--repo", tmp, "--out", outDir, "--source-sha", SHA40, "--plan-only"], { encoding: "utf8" });
      assert.notEqual(r2.status, 0);
      assert.match((r2.stderr || "") + (r2.stdout || ""), /symlink/i);
      // Prove sentinel never read: mode 000 plus error message names link path.
      // When running as root mode 000 is still readable, so we rely on distinct error message.
      // Also test FIFO would hang: if we replaced sentinel with FIFO, pack must fail without hanging.

      fs.unlinkSync(linkPath);
      const r3 = spawnSync(process.execPath, [PACK_RUNTIME, "--repo", tmp, "--out", outDir, "--source-sha", SHA40, "--plan-only"], { encoding: "utf8" });
      assert.equal(r3.status, 0, r3.stderr);
      const paths = JSON.parse(r3.stdout.trim());
      assert.ok(!paths.some((p) => p.includes("sentinel")));
      assert.ok(!paths.some((p) => p.includes("sealed")));
      // sentinel file still unread
      fs.rmSync(outDir, { recursive: true, force: true });
    } finally {}
  } finally { cleanup(tmp); }
});

test("pack: reports name, size, sha256 and source sha; rejects bad sha", () => {
  const { tmp } = mkFakeRepo();
  try {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "pack-out3-"));
    try {
      const r = spawnSync(process.execPath, [PACK_RUNTIME, "--repo", tmp, "--out", outDir, "--source-sha", SHA40], { encoding: "utf8" });
      assert.equal(r.status, 0);
      const info = JSON.parse(r.stdout.trim());
      assert.equal(info.sourceSha, SHA40);
      assert.ok(info.name.includes(SHA40.slice(0, 12)));
      assert.equal(typeof info.size, "number");
      assert.match(info.sha256, /^[0-9a-f]{64}$/);
      assert.ok(Array.isArray(info.paths));

      for (const bad of ["nothex", "ABCDEF1234567890abcdef1234567890abcdef12", "a".repeat(39), "a".repeat(41), "g".repeat(40)]) {
        const rb = spawnSync(process.execPath, [PACK_RUNTIME, "--repo", tmp, "--out", outDir, "--source-sha", bad], { encoding: "utf8" });
        assert.notEqual(rb.status, 0, `should reject ${bad}`);
      }
      fs.rmSync(outDir, { recursive: true, force: true });
    } finally {}
  } finally { cleanup(tmp); }
});

test("pack: excluded-name symlink is never followed", () => {
  // Filtering by name happens before stat/read; excluded-name symlink is skipped, not followed.
  const { tmp, sealedDir } = mkFakeRepo();
  try {
    const linkPath = path.join(tmp, "apps/web/dist/src/link-to-sealed");
    fs.symlinkSync(sealedDir, linkPath);
    // Sentinel inside sealed dir should never be read; make it FIFO to prove would hang if followed
    const sentinel = path.join(sealedDir, "sentinel.txt");
    // Already exists; also ensure mode 000
    try { fs.chmodSync(sentinel, 0o000); } catch {}
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "pack-out-excl-"));
    try {
      const r = spawnSync(process.execPath, [PACK_RUNTIME, "--repo", tmp, "--out", outDir, "--source-sha", SHA40], { encoding: "utf8" });
      // Should succeed because excluded-name symlink is skipped
      assert.equal(r.status, 0, `excluded-name symlink should be skipped, got stderr: ${r.stderr}`);
      const info = JSON.parse(r.stdout.trim());
      assert.ok(!info.paths.some((p) => p.includes("sealed")));
      assert.ok(!info.paths.some((p) => p.includes("sentinel")));
      assert.ok(!info.paths.some((p) => p.includes("link-to-sealed")));
      // Also verify artifact does not contain sealed content
      const artifactPath = path.join(outDir, info.name);
      const gz = fs.readFileSync(artifactPath);
      const parsed = JSON.parse(zlib.gunzipSync(gz).toString("utf8"));
      assert.ok(!parsed.entries.some((e) => e.path.includes("sealed")));
      assert.ok(!parsed.entries.some((e) => e.content.includes("DO_NOT_READ") || Buffer.from(e.content, "base64").toString().includes("DO_NOT_READ")));
      fs.rmSync(outDir, { recursive: true, force: true });
    } finally {}
  } finally { cleanup(tmp); }
});

test("pack: parser link to an unexpected destination is rejected before content is read", () => {
  function testOneCase(setup) {
    const { tmp, sealedDir } = mkFakeRepo();
    // Remove correct parser link first
    const linkPath = path.join(tmp, "services/bot/node_modules/@meta-sam/parser");
    try { fs.unlinkSync(linkPath); } catch {}
    const dest = setup(tmp, sealedDir);
    // Create relative link to dest
    const linkParent = path.dirname(linkPath);
    const rel = path.relative(linkParent, dest);
    fs.symlinkSync(rel, linkPath);
    // Make destination's package.json a FIFO or mode 000 to prove rejection is before content read
    const pkgJson = path.join(dest, "package.json");
    let isFifo = false;
    try {
      // dest may not have package.json; create dir and try to make FIFO
      fs.mkdirSync(dest, { recursive: true });
      // If package.json exists as file, remove and make FIFO
      try { fs.rmSync(pkgJson, { force: true }); } catch {}
      if (tryMakeFifo(pkgJson)) {
        isFifo = true;
      } else {
        // fallback: create dummy file with mode 000
        fs.writeFileSync(pkgJson, JSON.stringify({ name: "@meta-sam/parser" }));
        try { fs.chmodSync(pkgJson, 0o000); } catch {}
      }
    } catch {}
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "pack-out-parser-"));
    try {
      const r = spawnSync(process.execPath, [PACK_RUNTIME, "--repo", tmp, "--out", outDir, "--source-sha", SHA40], { encoding: "utf8", timeout: 5000 });
      assert.notEqual(r.status, 0, `should reject parser dest ${dest}, stderr=${r.stderr}`);
      const files = fs.readdirSync(outDir);
      assert.equal(files.length, 0, "no artifact should be written");
      const combined = (r.stderr || "") + (r.stdout || "");
      assert.match(combined, /parser link destination not allowed/i, `expected parser path-check error, got: ${combined}`);
      // --plan-only also fails with same distinct message
      const r2 = spawnSync(process.execPath, [PACK_RUNTIME, "--repo", tmp, "--out", outDir, "--source-sha", SHA40, "--plan-only"], { encoding: "utf8", timeout: 5000 });
      assert.notEqual(r2.status, 0);
      assert.match((r2.stderr || "") + (r2.stdout || ""), /parser link destination not allowed/i);
      // If FIFO, the test would have hung if content was read; timeout proves no hang beyond 5s already checked
    } finally {
      try { fs.chmodSync(pkgJson, 0o600); } catch {}
      fs.rmSync(outDir, { recursive: true, force: true });
      cleanup(tmp);
    }
  }

  // (i) fake sealed dir
  testOneCase((tmp, sealedDir) => sealedDir);
  // (ii) directory outside repo
  testOneCase((tmp, sealedDir) => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "outside-"));
    // Create a dir that looks like parser but outside repo
    const p = path.join(outside, "parser-outside");
    fs.mkdirSync(p, { recursive: true });
    return p;
  });
  // (iii) dir inside repo that does not match store pattern
  testOneCase((tmp, sealedDir) => {
    const p = path.join(tmp, "apps/web/custom-parser");
    fs.mkdirSync(p, { recursive: true });
    return p;
  });
  // (iv) store-pattern path with forbidden component
  testOneCase((tmp, sealedDir) => {
    const p = path.join(tmp, "node_modules/.pnpm/@meta-sam+parser@0.1.0/node_modules/@meta-sam/sealed-evil");
    fs.mkdirSync(p, { recursive: true });
    return p;
  });
});

test("pack: symlinked allowlisted ancestor is rejected before content is read", () => {
  const { tmp } = mkFakeRepo();
  try {
    // Replace apps/web/dist with symlink to a real-looking copy elsewhere
    const distPath = path.join(tmp, "apps/web/dist");
    const copyPath = path.join(tmp, "_dist_copy");
    fs.mkdirSync(path.join(copyPath, "src"), { recursive: true });
    // Copy required files to copyPath
    fs.copyFileSync(path.join(tmp, "apps/web/dist/src/public-start.js"), path.join(copyPath, "src/public-start.js"));
    fs.copyFileSync(path.join(tmp, "apps/web/dist/src/index.js"), path.join(copyPath, "src/index.js"));
    fs.copyFileSync(path.join(tmp, "apps/web/dist/src/render.js"), path.join(copyPath, "src/render.js"));
    // Make destination package.json unreachable? Actually ancestor check should fail before content read.
    // To prove before content read, make the copy's file a FIFO
    const fifoPath = path.join(copyPath, "src/public-start.js");
    try { fs.rmSync(fifoPath); } catch {}
    let isFifo = false;
    if (tryMakeFifo(fifoPath)) isFifo = true;
    else fs.writeFileSync(fifoPath, "console.log('start');");

    // Now replace original dist with symlink
    fs.rmSync(distPath, { recursive: true, force: true });
    fs.symlinkSync(copyPath, distPath);

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "pack-out-anc-"));
    try {
      const r = spawnSync(process.execPath, [PACK_RUNTIME, "--repo", tmp, "--out", outDir, "--source-sha", SHA40], { encoding: "utf8", timeout: 5000 });
      assert.notEqual(r.status, 0, `should reject symlinked ancestor, stderr=${r.stderr}`);
      const combined = (r.stderr || "") + (r.stdout || "");
      assert.match(combined, /symlinked ancestor not allowed/i);
      const files = fs.readdirSync(outDir);
      assert.equal(files.length, 0);
      const r2 = spawnSync(process.execPath, [PACK_RUNTIME, "--repo", tmp, "--out", outDir, "--source-sha", SHA40, "--plan-only"], { encoding: "utf8", timeout: 5000 });
      assert.notEqual(r2.status, 0);
      assert.match((r2.stderr || "") + (r2.stdout || ""), /symlinked ancestor not allowed/i);
      fs.rmSync(outDir, { recursive: true, force: true });
    } finally {}
  } finally { cleanup(tmp); }

  // Also test packages/core/dist variant
  const { tmp: tmp2 } = mkFakeRepo();
  try {
    const distPath = path.join(tmp2, "packages/core/dist");
    const copyPath = path.join(tmp2, "_core_dist_copy");
    fs.mkdirSync(path.join(copyPath, "src"), { recursive: true });
    fs.copyFileSync(path.join(tmp2, "packages/core/dist/src/index.js"), path.join(copyPath, "src/index.js"));
    fs.copyFileSync(path.join(tmp2, "packages/core/dist/src/types.js"), path.join(copyPath, "src/types.js"));
    fs.rmSync(distPath, { recursive: true, force: true });
    fs.symlinkSync(copyPath, distPath);
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "pack-out-anc2-"));
    try {
      const r = spawnSync(process.execPath, [PACK_RUNTIME, "--repo", tmp2, "--out", outDir, "--source-sha", SHA40, "--plan-only"], { encoding: "utf8", timeout: 5000 });
      assert.notEqual(r.status, 0);
      assert.match((r.stderr || "") + (r.stdout || ""), /symlinked ancestor not allowed/i);
      fs.rmSync(outDir, { recursive: true, force: true });
    } finally {}
  } finally { cleanup(tmp2); }
});

test("pack: approved parser link in the expected store location is accepted", () => {
  const { tmp } = mkFakeRepo();
  try {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "pack-out-ok-"));
    try {
      const r = spawnSync(process.execPath, [PACK_RUNTIME, "--repo", tmp, "--out", outDir, "--source-sha", SHA40], { encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      const info = JSON.parse(r.stdout.trim());
      assert.ok(info.paths.includes("node_modules/@meta-sam/parser/package.json"));
      assert.ok(info.paths.includes("node_modules/@meta-sam/parser/dist/index.js"));
      // Verify the parser link was relative
      const linkVal = fs.readlinkSync(path.join(tmp, "services/bot/node_modules/@meta-sam/parser"));
      assert.ok(!path.isAbsolute(linkVal), "parser link must be relative");
      assert.equal(linkVal, "../../../../node_modules/.pnpm/@meta-sam+parser@0.1.0/node_modules/@meta-sam/parser");
      fs.rmSync(outDir, { recursive: true, force: true });
    } finally {}
  } finally { cleanup(tmp); }
});
