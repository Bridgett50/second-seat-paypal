import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// System Chrome when PLAYWRIGHT_CHROME_PATH is set or /usr/bin/google-chrome exists; otherwise Playwright's bundled Chromium.
const CHROME_PATH = process.env.PLAYWRIGHT_CHROME_PATH || "/usr/bin/google-chrome";
const CHROME_LAUNCH: { executablePath?: string } =
  process.env.PLAYWRIGHT_CHROME_PATH || existsSync(CHROME_PATH) ? { executablePath: CHROME_PATH } : {};

export default defineConfig({
  testDir: "./e2e-meeting-room",
  // One worker: specs share one server, so parallel runs would race.
  workers: 1,
  outputDir: "test-results/meeting-room",
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4174",
  },
  webServer: {
    command: "node dist/src/server.js",
    url: "http://127.0.0.1:4174/meeting-room",
    reuseExistingServer: false,
    // Test mode only on this private loopback process (the server binds 127.0.0.1).
    env: {
      PORT: "4174",
      SECOND_SEAT_TEST_MODE: "1",
      MODEL_API_KEY: "test-dummy-not-a-key",
      META_API_KEY: "test-dummy-not-a-key",
    },
  },
  projects: [
    {
      name: "chrome",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { ...CHROME_LAUNCH },
        headless: true,
      },
    },
  ],
});
