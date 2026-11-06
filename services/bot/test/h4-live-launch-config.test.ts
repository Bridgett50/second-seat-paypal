import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateRunConfig } from "../src/release/runConfig.js";

// H4: the drafted live launch config pins the verified model revision and
// image digest, projects cleanly through launch_contract, and validates now
// that Bridgett has recorded the review (2026-10-28).
const repo = join(__dirname, "..", "..", "..");
const cfgPath = join(repo, "config", "live", "glimmer-launch-config.json");
const REV = "cec94fcfd6512f2cfe708138c32533b346ea4f69";
const DIGEST = "sha256:413c8fbecb1204a218117c77a4ea4b3a211d5686ff99c31d82ba6dd0cec8c5a6";

function load(): Record<string, any> {
  return JSON.parse(readFileSync(cfgPath, "utf8"));
}

describe("h4 live launch config", () => {
  it("H4-1 pins the verified revision and image digest", () => {
    const cfg = load();
    expect(cfg.model.revision).toBe(REV);
    expect(cfg.image.digest).toBe(DIGEST);
    expect(cfg.image.ref).toBe(`vllm/vllm-openai@${DIGEST}`);
  });

  it("H4-2 validates with Bridgett's recorded review (confirmed 2026-10-28)", () => {
    const cfg = load();
    expect(cfg.review.status).toBe("reviewed");
    expect(cfg.review.reviewer).toBe("Bridgett Sanders");
    expect(cfg.review.reviewed_at).toBe("2026-10-28");
    expect(validateRunConfig(cfg)).toEqual([]);
    const pending = { ...cfg, review: { ...cfg.review, status: "PENDING-BRIDGETT-CONFIRMATION", reviewer: "", reviewed_at: "" } };
    const errors = validateRunConfig(pending);
    expect(errors.length, "pending review must not validate").toBeGreaterThan(0);
    expect(errors.every((e) => e.startsWith("review.")), `only review errors expected: ${errors.join("; ")}`).toBe(true);
  });

  it("H4-3 projects through launch_contract with the pinned revision and image", () => {
    const code = [
      "import json, sys",
      `sys.path.insert(0, ${JSON.stringify(join(repo, "infra", "modal"))})`,
      "import launch_contract as lc",
      `cfg = json.load(open(${JSON.stringify(cfgPath)}))`,
      "flat, errs = lc.project_launch(cfg)",
      "argv = lc.vllm_argv(cfg)",
      "print(json.dumps({'errs': errs, 'image': (flat or {}).get('image'), 'rev': argv[argv.index('--revision') + 1], 'len': argv[argv.index('--max-model-len') + 1]}))",
    ].join("\n");
    const res = spawnSync("python3", ["-c", code], { encoding: "utf8", env: { PATH: process.env["PATH"] ?? "" } });
    expect(res.status, res.stderr).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.errs).toEqual([]);
    expect(out.image).toBe(`vllm/vllm-openai@${DIGEST}`);
    expect(out.rev).toBe(REV);
    expect(out.len).toBe("16384");
  });
});
