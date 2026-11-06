import { test, expect } from "vitest";
import { chromium, expect as browserExpect } from "@playwright/test";
import { existsSync } from "node:fs";
import { MEET_WORKER_CLIENT_JS } from "../src/meetWorkerClient.js";
test("meet worker happy path", async () => {
  const urls: string[] = [];
  const bodies: unknown[] = [];
  let cur: unknown = { status: "idle", accepted: 0, canPrepare: false, snapshot: { roomId: "room-A", conversation: { utterances: [] } }, html: "<p>Owner twin pane</p>" };
  const chromePath = process.env.PLAYWRIGHT_CHROME_PATH ?? (existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : undefined);
  const browser = await chromium.launch(chromePath ? { executablePath: chromePath } : {});
  try {
    const page = await browser.newPage();
    await page.route("**/*", async (route) => {
      const req = route.request();
      urls.push(req.url());
      const u = new URL(req.url());
      if (req.method() === "POST" && u.pathname.includes("/api/meeting-room/worker/")) {
        const b = req.postData();
        if (b) try { bodies.push(JSON.parse(b)); } catch { bodies.push(b); }
      }
      if (u.pathname === "/meeting-room" || u.pathname === "/meeting-room/") {
        return route.fulfill({ status: 200, contentType: "text/html", body: '<!doctype html><body data-meet-worker="1"><div id="mr-root" data-room-id="room-A">twin</div></body>' });
      }
      if (u.pathname === "/api/meeting-room/worker/status") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(cur) });
      }
      if (u.pathname === "/api/meeting-room/worker/connect") {
        cur = { status: "listening", accepted: 0, canPrepare: false, snapshot: { roomId: "room-A", conversation: { utterances: [] } }, html: "<p>Owner twin pane</p>" };
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(cur) });
      }
      if (u.pathname === "/api/meeting-room/worker/stop") {
        cur = { status: "stopped", accepted: 1, canPrepare: false, snapshot: { roomId: "room-A", conversation: { utterances: [{ utteranceId: "u1", revision: 1, speaker: "Synthetic owner", text: "budget 700" }] } }, html: "<p>Owner twin pane</p>" };
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(cur) });
      }
      return route.fulfill({ status: 200, contentType: "text/plain", body: "" });
    });
    await page.goto("http://127.0.0.1:4173/meeting-room");
    await page.addScriptTag({ content: MEET_WORKER_CLIENT_JS });
    await browserExpect(page.locator("#mr-root")).toHaveAttribute("data-room-id", "room-A");
    await page.locator("#mr-meet-url").fill("https://meet.google.com/abc-defg-hij");
    await page.locator("#mr-meet-name").fill("AI twin (test)");
    await browserExpect(page.locator("#mr-meet-connect")).toBeEnabled();
    await page.locator("#mr-meet-connect").click();
    await browserExpect(page.locator("#mr-meet-status")).toContainText("Listening");
    await browserExpect(page.locator("#mr-meet-stop")).toBeEnabled();
    await page.locator("#mr-meet-stop").click();
    await browserExpect(page.locator("#mr-meet-status")).toContainText("Stopped");
    await browserExpect(page.locator("#mr-review-rows textarea")).toHaveValue("budget 700");
    await browserExpect(page.locator("#mr-review-rows")).toContainText("Unverified caption");
    await browserExpect(page.locator("#mr-meet-prepare")).toBeDisabled();
    await browserExpect(page.locator("#mr-root")).toBeVisible();
    expect(bodies).toEqual([{ roomId: "room-A", meetingUrl: "https://meet.google.com/abc-defg-hij", displayName: "AI twin (test)" }, { roomId: "room-A" }]);
    for (const u of urls) expect(new URL(u).origin).toBe("http://127.0.0.1:4173");
    expect(urls.filter((u) => new URL(u).pathname === "/api/meeting-room/worker/connect").length).toBe(1);
    expect(urls.filter((u) => new URL(u).pathname === "/api/meeting-room/worker/stop").length).toBe(1);
    expect(urls.filter((u) => new URL(u).pathname === "/api/meeting-room/worker/status").length).toBeGreaterThanOrEqual(1);
  } finally { await browser.close(); }
}, 40000);
test("capture lost after listening is not reported as a start failure", async () => {
  let cur: unknown = { status: "idle", accepted: 0, canPrepare: false, snapshot: { roomId: "room-A", conversation: { utterances: [] } }, html: "<p>Owner twin pane</p>" };
  let polls = 0;
  const chromePath = process.env.PLAYWRIGHT_CHROME_PATH ?? (existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : undefined);
  const browser = await chromium.launch(chromePath ? { executablePath: chromePath } : {});
  try {
    const page = await browser.newPage();
    await page.route("**/*", async (route) => {
      const u = new URL(route.request().url());
      if (u.pathname === "/meeting-room") return route.fulfill({ status: 200, contentType: "text/html", body: '<!doctype html><body data-meet-worker="1"><div id="mr-root" data-room-id="room-A">twin</div></body>' });
      if (u.pathname === "/api/meeting-room/worker/status") {
        polls++;
        if (polls >= 2) cur = { status: "failed", accepted: 0, canPrepare: false, snapshot: { roomId: "room-A", conversation: { utterances: [] } }, html: "<p>Owner twin pane</p>" };
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(cur) });
      }
      if (u.pathname === "/api/meeting-room/worker/connect") {
        polls = 0;
        cur = { status: "listening", accepted: 0, canPrepare: false, snapshot: { roomId: "room-A", conversation: { utterances: [] } }, html: "<p>Owner twin pane</p>" };
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(cur) });
      }
      return route.fulfill({ status: 200, contentType: "text/plain", body: "" });
    });
    await page.goto("http://127.0.0.1:4173/meeting-room");
    await page.addScriptTag({ content: MEET_WORKER_CLIENT_JS });
    await page.locator("#mr-meet-url").fill("https://meet.google.com/abc-defg-hij");
    await page.locator("#mr-meet-name").fill("AI twin (test)");
    await page.locator("#mr-meet-connect").click();
    await browserExpect(page.locator("#mr-meet-status")).toContainText("Listening");
    await browserExpect(page.locator("#mr-meet-status")).toHaveText("Worker stopped (capture lost).", { timeout: 10000 });
  } finally { await browser.close(); }
}, 40000);
