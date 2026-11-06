// Frozen runtime identities for the Glimmer redaction prompt, response
// schema, and scorer.
//
// prompt = sha256(GLIMMER_SYSTEM_PROMPT utf8) from
//          ../dist/src/private/redact.js (the exact string fetchBody sends).
// schema = sha256(JSON.stringify(GLIMMER_RESPONSE_SCHEMA)) from the same file.
// scorer = sha256(bytes of redaction-eval-lib.mjs + redaction-eval-runner.mjs
//          concatenated in that order, both beside this file).
//
// Only allowlisted public source (this package's own scripts/dist) is read;
// no holdout, no network, no inference. As a CLI (`node
// scripts/frozen-identities.mjs`) prints the JSON {"prompt","schema","scorer"}.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export async function runtimeIdentities() {
  const { GLIMMER_SYSTEM_PROMPT, GLIMMER_RESPONSE_SCHEMA } = await import(
    "../dist/src/private/redact.js"
  );
  const prompt = createHash("sha256")
    .update(String(GLIMMER_SYSTEM_PROMPT), "utf8")
    .digest("hex");
  const schema = createHash("sha256")
    .update(JSON.stringify(GLIMMER_RESPONSE_SCHEMA), "utf8")
    .digest("hex");
  const lib = readFileSync(join(here, "redaction-eval-lib.mjs"));
  const runner = readFileSync(join(here, "redaction-eval-runner.mjs"));
  const scorer = createHash("sha256")
    .update(Buffer.concat([lib, runner]))
    .digest("hex");
  return { prompt, schema, scorer };
}

if (
  typeof process.argv[1] === "string" &&
  process.argv[1].endsWith("frozen-identities.mjs")
) {
  runtimeIdentities().then(
    (ids) => {
      console.log(JSON.stringify(ids));
    },
    (err) => {
      console.error(`error: cannot compute runtime identities: ${err?.message ?? err}`);
      process.exit(2);
    },
  );
}
