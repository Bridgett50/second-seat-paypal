import { expect, it } from "vitest";
import { chromium } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { createMeetAdmissionBrowser } from "../src/meetAdmissionBrowser.js";
it("local synthetic admission browser", async () => {
const holder: { browser?: Browser; page?: Page; scope?: Readonly<{ meetingUrl: string; displayName: string }> } = {};
const requests: string[] = [];
let disconnects = 0;
const validScope = { meetingUrl: "https://meet.google.com/abc-defg-hij", displayName: "Bridgett AI twin (test)" };
const launch = async () => {
const o: Parameters<typeof chromium.launch>[0] = { headless: true, timeout: 10000 };
const p = process.env.PLAYWRIGHT_CHROME_PATH;
if (p) Object.assign(o, { executablePath: p });
else if (existsSync("/usr/bin/google-chrome")) Object.assign(o, { executablePath: "/usr/bin/google-chrome" });
const b = await chromium.launch(o);
holder.browser = b;
b.on("disconnected", () => { disconnects++; });
return b;
};
const driver = async (page: Page, scope: Readonly<{ meetingUrl: string; displayName: string }>, signal: AbortSignal) => {
holder.page = page;
holder.scope = scope;
await page.route("**/*", async r => { requests.push(r.request().url()); return r.abort(); });
await page.setContent("<h1>synthetic local proof</h1>");
return true;
};
const admission = createMeetAdmissionBrowser<Page>(validScope, { launch, admit: driver });
const controller = new AbortController();
try {
const joined = await admission.join(validScope.meetingUrl, validScope.displayName, controller.signal);
expect(joined).toBe(true);
expect(holder.browser).toBeDefined();
expect(holder.browser!.isConnected()).toBe(true);
expect(holder.page).toBeDefined();
expect(await holder.page!.textContent("h1")).toBe("synthetic local proof");
expect(holder.scope).toEqual(validScope);
expect(holder.scope).not.toBe(validScope);
expect(Object.isFrozen(holder.scope!)).toBe(true);
expect(requests).toEqual([]);
const disconnected: Promise<void> = new Promise<void>((resolve, reject) => {
const timer = setTimeout(() => reject(new Error("disconnected timeout 5000ms")), 5000);
holder.browser!.once('disconnected', () => { clearTimeout(timer); resolve(); });
});
controller.abort();
await disconnected;
expect(holder.browser!.isConnected()).toBe(false);
await admission.leave();
expect(holder.browser!.isConnected()).toBe(false);
expect(disconnects).toBe(1);
await admission.leave();
expect(disconnects).toBe(1);
} finally {
try { await admission.leave(); } finally { if (holder.browser?.isConnected()) await holder.browser.close(); }
}
}, 20000);
