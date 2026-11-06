#!/usr/bin/env node
// Offline meeting room demo runner. Walks the whole `?demo=1` guided flow
// headlessly (build the core package, then run the committed demo e2e
// suite), then points at the live page. Narrated version of the same flow:
// the "Meeting room demo walkthrough" section in README.md.
import { spawnSync } from "node:child_process";

function run(args) {
  const res = spawnSync(args[0], args.slice(1), { stdio: "inherit", shell: false });
  if (typeof res.status === "number" && res.status !== 0) process.exit(res.status);
  if (res.error) throw res.error;
}

run(["pnpm", "--filter", "@second-seat/core", "build"]);
run(["pnpm", "--filter", "@second-seat/bot", "exec", "vitest", "run", "test/t2-demo-e2e.test.ts"]);
console.log(
  'Open http://127.0.0.1:4173/meeting-room?demo=1 (see README.md "Meeting room demo walkthrough")',
);
