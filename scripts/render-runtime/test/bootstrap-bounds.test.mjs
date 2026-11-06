import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BOOTSTRAP_SRC = fileURLToPath(new URL("../bootstrap.mjs", import.meta.url));

test("bootstrap: oversized archive is rejected during decompression", { timeout: 30000 }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bootstrap-test-"));
  try {
    const LIMIT = 100 * 1024 * 1024;
    const oversized = LIMIT + 1024;
    // highly compressible payload
    const bigContent = "a".repeat(oversized);
    const artifact = {
      manifest: { sourceSha: "c".repeat(40) },
      entries: [{ path: "apps/web/dist/src/public-start.js", type: "file", content: Buffer.from(bigContent).toString("base64") }],
    };
    const json = JSON.stringify(artifact);
    const gz = zlib.gzipSync(Buffer.from(json, "utf8"));
    // ensure compressed stays small
    assert.ok(gz.length < 2 * 1024 * 1024, `compressed too large: ${gz.length}`);

    const artifactPath = path.join(tmp, "artifact.json.gz");
    fs.writeFileSync(artifactPath, gz);
    const sha256 = crypto.createHash("sha256").update(gz).digest("hex");
    const sourceSha = "c".repeat(40);

    // fill bootstrap copy
    let boot = fs.readFileSync(BOOTSTRAP_SRC, "utf8");
    boot = boot.replaceAll('"__ARTIFACT_URL__"', JSON.stringify("file://" + artifactPath));
    boot = boot.replaceAll('"__ARTIFACT_SHA256__"', JSON.stringify(sha256));
    boot = boot.replaceAll('"__SOURCE_SHA__"', JSON.stringify(sourceSha));
    boot = boot.replaceAll('"__LOCAL_TEST__"', '"true"');
    const bootPath = path.join(tmp, "filled-bootstrap.mjs");
    fs.writeFileSync(bootPath, boot);
    const b64 = Buffer.from(fs.readFileSync(bootPath, "utf8")).toString("base64");

    const result = spawnSync(process.execPath, ["--input-type=module", "-e", "await import('data:text/javascript;base64,' + process.env.SECOND_SEAT_BOOTSTRAP_B64)"], {
      env: { ...process.env, SECOND_SEAT_BOOTSTRAP_B64: b64 },
      encoding: "utf8",
      timeout: 20000,
    });

    assert.notEqual(result.status, 0, `should fail, stderr=${result.stderr} stdout=${result.stdout}`);
    const combined = (result.stderr || "") + (result.stdout || "");
    assert.match(combined.toLowerCase(), /(too large|decompressed|limit|too big)/i, `expected size error, got: ${combined}`);
    // ensure no public-start.js was started: bootstrap should not have spawned successfully; check exit non-zero already
    // also ensure tmp extraction did not leave a running process - just check bootstrap didn't print start marker
    assert.ok(!combined.includes("public-start-started-sentinel"));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
