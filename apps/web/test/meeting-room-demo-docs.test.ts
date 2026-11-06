import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

it("T18-6 the meeting room demo runner and the README walkthrough reference each other", () => {
  const runner = readFileSync(join(ROOT, "scripts", "meeting-room-demo.mjs"), "utf8");
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  for (const needle of [
    "t2-demo-e2e.test.ts",
    "vitest",
    "README.md",
    "Meeting room demo walkthrough",
  ]) {
    expect(runner, `runner missing ${needle}`).toContain(needle);
  }
  expect(readme).toContain("## Meeting room demo walkthrough");
  expect(readme).toContain("node scripts/meeting-room-demo.mjs");
  expect(readme).toContain("/meeting-room?demo=1");
  expect(runner).not.toContain("SECOND_SEAT_TEST_MODE");
});
