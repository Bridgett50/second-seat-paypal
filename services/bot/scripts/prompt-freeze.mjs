#!/usr/bin/env node
// Prompt freeze: sha256 of every file in services/bot/prompts/ plus the model
// ids and sampling/reasoning settings read from source. Writes
// eval/results/prompt-freeze.md. Fixture mode only; reads source, no network.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PROMPTS = join(ROOT, "services/bot/prompts");
const SRC = join(ROOT, "services/bot/src");

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

const promptRows = readdirSync(PROMPTS).filter((f) => f.endsWith(".txt")).sort()
  .map((f) => ({ file: `services/bot/prompts/${f}`, sha256: sha256(readFileSync(join(PROMPTS, f), "utf8")) }));

// Inline Glimmer redaction system prompt: sha256 of the exact template literal
// source text between the backticks of the `{ role: "system", content: `...` }`
// message in fetchBody (NOT FOUND when the grab misses, never a crash).
const redactSrc = readFileSync(join(ROOT, "services/bot/src/private/redact.ts"), "utf8");
const redactMatch = redactSrc.match(/\{\s*role:\s*"system",\s*content:\s*`([\s\S]*?)`\s*\}/);
promptRows.push({
  file: "services/bot/src/private/redact.ts (inline Glimmer system prompt)",
  sha256: redactMatch?.[1] === undefined ? "NOT FOUND" : sha256(redactMatch[1]),
});

// Settings read from source (regex over the listed files, not hardcoded).
const grabs = [];
function grab(file, pattern, label) {
  const src = readFileSync(join(ROOT, file), "utf8");
  const m = src.match(pattern);
  grabs.push({ setting: label, value: m ? (m[1] ?? m[0]).trim().slice(0, 120) : "NOT FOUND", source: file });
}
grab("services/bot/src/brief/muse.ts", /BRIEF_MODEL\s*=\s*"([^"]+)"/, "brief model (BRIEF_MODEL)");
grab("services/bot/src/brief/muse.ts", /reasoning_effort:\s*"([^"]+)"/, "brief reasoning_effort");
grab("services/bot/src/brief/muse.ts", /BRIEF_SEED\s*=\s*(\d+)/, "brief seed (BRIEF_SEED)");
grab("services/bot/src/brief/muse.ts", /BRIEF_MAX_COMPLETION_TOKENS\s*=\s*(\d+)/, "brief max_completion_tokens");
grab("services/bot/src/brief/muse.ts", /temperature[^,]*|top_p[^,]*|response_format:\s*\{[^}]*strict:\s*true/, "brief sampling/response_format");
grab("services/bot/src/vision/sam.ts", /SAM_MODEL\s*=\s*"([^"]+)"/, "vision model (SAM_MODEL)");
grab("services/bot/src/shield/classify.ts", /reasoning_effort:\s*"([^"]+)"/, "shield reasoning_effort");
grab("services/bot/src/shield/classify.ts", /PRESSURE_MODEL\s*=\s*"([^"]+)"|MODEL\s*=\s*"([^"]+)"/, "shield model");
grab("services/bot/src/private/redact.ts", /temperature:\s*([\d.]+)/, "redact temperature");
grab("services/bot/src/private/redact.ts", /top_p:\s*([\d.]+)/, "redact top_p");
grab("services/bot/src/judge/support.ts", /reasoning_effort:\s*"([^"]+)"/, "judge reasoning_effort");

const md = [
  "# Prompt freeze",
  "",
  "Prompt file hashes (sha256):",
  "",
  "| file | sha256 |",
  "| --- | --- |",
  ...promptRows.map((r) => `| ${r.file} | ${r.sha256} |`),
  "",
  "Model ids and settings read from source:",
  "",
  "| setting | value | source |",
  "| --- | --- | --- |",
  ...grabs.map((g) => `| ${g.setting} | ${g.value} | ${g.source} |`),
  "",
  "Fixture mode, not production. Re-run `node services/bot/scripts/prompt-freeze.mjs` to refresh.",
  "",
].join("\n");
mkdirSync(join(ROOT, "eval/results"), { recursive: true });
writeFileSync(join(ROOT, "eval/results/prompt-freeze.md"), md);
console.log(md);
