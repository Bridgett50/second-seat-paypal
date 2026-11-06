#!/usr/bin/env node
/**
 * check-hashes.mjs — refuse to score sealed truth that changed.
 *
 * Verifies every file listed in eval/truth/SHA256SUMS against its
 * recorded sha256. Exit 0 when all match; exit 1 (with stderr detail)
 * on any mismatch, missing file, or malformed line. The scorer must
 * run this first and abort on a nonzero exit.
 *
 * Usage: node eval/check-hashes.mjs [truthDir]
 * Defaults to the eval/truth directory next to this script.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function verifyHashes(truthDir) {
  const dir = resolve(truthDir);
  const sumsFile = join(dir, "SHA256SUMS");
  if (!existsSync(sumsFile)) {
    throw new Error(`missing sums file: ${sumsFile}`);
  }
  const failures = [];
  const lines = readFileSync(sumsFile, "utf8").split("\n");
  let checked = 0;
  lines.forEach((raw, index) => {
    const line = index + 1;
    if (raw.trim() === "") {
      return;
    }
    const match = /^([0-9a-f]{64})  (.+)$/.exec(raw.replace(/\r$/, ""));
    if (match === null) {
      failures.push(`SHA256SUMS line ${line}: malformed`);
      return;
    }
    const file = join(dir, match[2]);
    if (!existsSync(file)) {
      failures.push(`SHA256SUMS line ${line}: missing file ${match[2]}`);
      return;
    }
    const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
    if (actual !== match[1]) {
      failures.push(`SHA256SUMS line ${line}: hash mismatch for ${match[2]}`);
      return;
    }
    checked += 1;
  });
  if (checked === 0) {
    failures.push("SHA256SUMS: no entries checked");
  }
  return { checked, failures };
}

const invokedAsCli =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsCli) {
  const here = dirname(fileURLToPath(import.meta.url));
  const truthDir = process.argv[2] ?? join(here, "truth");
  let result;
  try {
    result = verifyHashes(truthDir);
  } catch (error) {
    console.error(`hash check failed: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
  if (result.failures.length > 0) {
    for (const failure of result.failures) {
      console.error(`hash check failed: ${failure}`);
    }
    process.exit(1);
  }
  console.log(`hash check ok: ${result.checked} files verified`);
}
