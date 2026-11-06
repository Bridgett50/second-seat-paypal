import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { toNodeImportSpecifier } from "../services/bot/test/support/import-url.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const guard = join(here, "..", "services", "bot", "test", "support", "sealed-guard.mjs");
const tmpRoot = join(here, "..", "services", "bot", "test", "support", "global-tmp.mjs");
const flag = `--import ${toNodeImportSpecifier(guard)}`;
if (!process.env["NODE_OPTIONS"]?.includes(guard)) {
  process.env["NODE_OPTIONS"] = process.env["NODE_OPTIONS"] ? `${process.env["NODE_OPTIONS"]} ${flag}` : flag;
}

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: [guard],
    globalSetup: [tmpRoot],
  },
});
