import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import type { Server } from "node:http";
import { chromium, expect as pwExpect, type Browser, type BrowserContext, type Page, type Route } from "@playwright/test";
import { createWebServer } from "../src/server.js";
import { createMeetingRoomService, type CandidateReasonerInput } from "../src/meetingRoom.js";

const TEST_ENV: Readonly<Record<string, string | undefined>> = { SECOND_SEAT_TEST_MODE: "1" };
const CHROME_PATH = process.env.PLAYWRIGHT_CHROME_PATH || "/usr/bin/google-chrome";
const CHROME_LAUNCH: { executablePath?: string } = process.env.PLAYWRIGHT_CHROME_PATH || existsSync(CHROME_PATH) ? { executablePath: CHROME_PATH } : {};
const API = "/api/meeting-room";

let server: Server;
let baseUrl: string;
let browser: Browser;
let svc: ReturnType<typeof createMeetingRoomService>;
const nonLoopback: string[] = [];
const reasonerCalls: CandidateReasonerInput[] = [];

function fakeReasoner(input: CandidateReasonerInput): Promise<unknown> {
  reasonerCalls.push(input);
  return Promise.resolve({
    subject: "Meeting on 2026-11-15",
    body: "Thanks for the discussion.",
    sourceRefs: [{ utteranceId: "u1", revision: 1 }]
  });
}

beforeAll(async () => {
  svc = createMeetingRoomService({
    env: { SECOND_SEAT_TEST_MODE: "1" },
    conversationInput: true,
    sessionPolicy: true,
    candidateReasoner: fakeReasoner
  });
  const app = createWebServer({ meetingRoom: svc });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => { server.once("listening", () => resolve()); });
  const addr = server.address();
  if (addr === null || typeof addr === "string") throw new Error("no address");
  baseUrl = `http://127.0.0.1:${String(addr.port)}`;
  browser = await chromium.launch({ headless: true, ...CHROME_LAUNCH });
});

afterAll(async () => {
  if (browser) await browser.close();
  if (server) await new Promise<void>((resolve, reject) => { server.close((e) => { if (e) reject(e); else resolve(); }); });
});

describe("meeting-room candidate adopt browser", () => {
  it("adopts released candidate from mr-candidate-panel", async () => {
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    try {
      if (!browser) throw new Error("no browser");
      context = await browser.newContext();
      page = await context.newPage();
      await context.route("**/*", (route: Route) => {
        const url = route.request().url();
        const u = new URL(url);
        if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") {
          nonLoopback.push(url);
          return route.abort();
        }
        return route.continue();
      });
      await page.goto(`${baseUrl}/meeting-room`, { waitUntil: "domcontentloaded" });
      const guidanceInput = page.locator("#guidance-input");
      await guidanceInput.fill("Do not share any dates.");
      const guideRespPromise = page.waitForResponse((r) => {
        if (!r.url().includes(API) || r.request().method() !== "POST") return false;
        try {
          const data = r.request().postDataJSON();
          return data !== null && data !== undefined && data.action === "guide";
        } catch {
          return false;
        }
      });
      await page.locator("#guidance-send").click();
      const guideResp = await guideRespPromise;
      expect(guideResp.ok()).toBe(true);
      const cookies = await context.cookies();
      const mrCookie = cookies.find((c) => c.name === "mr_store");
      if (mrCookie === null || mrCookie === undefined) throw new Error("missing mr_store");
      const cookieHeader = `mr_store=${mrCookie.value}`;
      const roomEl = page.locator("#mr-root");
      const roomId = await roomEl.getAttribute("data-room-id");
      if (roomId === null || roomId === undefined) throw new Error("missing roomId");
      const headers = { host: new URL(baseUrl).host, cookie: cookieHeader };
      const stateBefore = await svc.actAs(mrCookie.value, { roomId, action: "state" }, headers);
      if (stateBefore.body.snapshot === null || stateBefore.body.snapshot === undefined) throw new Error("missing snapshot");
      const selectedMeetingId = stateBefore.body.snapshot.view.selectedMeetingId;
      if (selectedMeetingId === null || selectedMeetingId === undefined) throw new Error("missing selectedMeetingId");
      const ing = svc.ingestConversationAs(mrCookie.value, roomId, {
        version: 1,
        meetingId: selectedMeetingId,
        utteranceId: "u1",
        sequence: 1,
        revision: 1,
        speaker: "a",
        text: "We met to discuss quarterly planning."
      });
      expect(ing.status).toBe(200);
      await page.waitForSelector("#mr-candidate-panel");
      await pwExpect.poll(async () => {
        const s = await svc.actAs(mrCookie.value, { roomId, action: "state" }, headers);
        return s.body.snapshot?.candidatePreview?.status;
      }).toBe("released");
      const stateAfter = await svc.actAs(mrCookie.value, { roomId, action: "state" }, headers);
      if (stateAfter.body.snapshot === null || stateAfter.body.snapshot === undefined) throw new Error("missing snapshot after ingest");
      const preview = stateAfter.body.snapshot.candidatePreview;
      if (preview === null || preview === undefined) throw new Error("missing preview");
      expect(preview.status).toBe("released");
      if (preview.evaluatedSubject === null || preview.evaluatedSubject === undefined) throw new Error("missing evaluatedSubject");
      if (preview.evaluatedBody === null || preview.evaluatedBody === undefined) throw new Error("missing evaluatedBody");
      const panel = page.locator("#mr-candidate-panel");
      await pwExpect(panel).toContainText(preview.evaluatedSubject, { timeout: 2000 });
      await pwExpect(panel).toContainText(preview.evaluatedBody, { timeout: 2000 });
      const adoptBtn = page.locator('[data-mr-action="adopt-candidate"]');
      await pwExpect(adoptBtn).toContainText("Use this email", { timeout: 2000 });
      let adoptCount = 0;
      page.on("request", (req) => {
        if (!req.url().includes(API) || req.method() !== "POST") return;
        try {
          const data = req.postDataJSON();
          if (data !== null && data !== undefined && data.action === "adopt-candidate") adoptCount++;
        } catch {
        }
      });
      const editorPre = page.locator("#package-editor");
      const unsavedText = "UNSAVED-TEST-DRAFT-" + String(Date.now());
      await editorPre.fill(unsavedText);
      await pwExpect(adoptBtn).toBeDisabled({ timeout: 2000 });
      const stateRespPromise = page.waitForResponse((r) => {
        if (!r.url().includes(API) || r.request().method() !== "POST") return false;
        try {
          const data = r.request().postDataJSON();
          return data !== null && data !== undefined && data.action === "state";
        } catch {
          return false;
        }
      });
      await adoptBtn.dispatchEvent("click");
      await stateRespPromise;
      await pwExpect(editorPre).toHaveValue(unsavedText, { timeout: 2000 });
      await pwExpect(adoptBtn).toBeDisabled({ timeout: 2000 });
      expect(adoptCount).toBe(0);
      await page.reload({ waitUntil: "domcontentloaded" });
      await pwExpect(adoptBtn).toBeEnabled({ timeout: 2000 });
      const adoptRespPromise = page.waitForResponse((r) => {
        if (!r.url().includes(API) || r.request().method() !== "POST") return false;
        try {
          const data = r.request().postDataJSON();
          return data !== null && data !== undefined && data.action === "adopt-candidate";
        } catch {
          return false;
        }
      });
      await adoptBtn.click();
      const adoptResp = await adoptRespPromise;
      expect(adoptResp.ok()).toBe(true);
      expect(adoptCount).toBe(1);
      const afterAdopt = await svc.actAs(mrCookie.value, { roomId, action: "state" }, headers);
      if (afterAdopt.body.snapshot === null || afterAdopt.body.snapshot === undefined) throw new Error("missing adopt snapshot");
      expect(afterAdopt.body.snapshot.view.draft.approved).toBe(false);
      expect(afterAdopt.body.snapshot.copyText).toBeNull();
      const editor = page.locator("#package-editor");
      await pwExpect(editor).toHaveValue(preview.evaluatedSubject + "\n\n" + preview.evaluatedBody, { timeout: 2000 });
      let heldAdoptCount = 0;
      let serverAnsweredResolve: () => void = () => {};
      const serverAnswered = new Promise<void>((r) => { serverAnsweredResolve = r; });
      let releaseResolve: () => void = () => {};
      const release = new Promise<void>((r) => { releaseResolve = r; });
      const apiRoute = (url: URL) => url.pathname === API;
      await page.route(apiRoute, async (route: Route) => {
          const d = route.request().postDataJSON();
          if (d !== null && d !== undefined && d.action === "adopt-candidate") {
            heldAdoptCount += 1;
            const response = await route.fetch();
            serverAnsweredResolve();
            await release;
            await route.fulfill({ response });
            return;
          }
          await route.fallback();
      });
      const lateEdit = "LATE-EDIT-" + String(Date.now());
      const heldAdoptRespPromise = page.waitForResponse((r) => {
        if (!r.url().includes(API) || r.request().method() !== "POST") return false;
        try { const data = r.request().postDataJSON(); return data !== null && data !== undefined && data.action === "adopt-candidate"; } catch { return false; }
      });
      await page.locator('[data-mr-action="adopt-candidate"]').click();
      await serverAnswered;
      await page.locator("#package-editor").fill(lateEdit);
      releaseResolve();
      const heldAdoptResp = await heldAdoptRespPromise;
      expect(heldAdoptResp.status()).toBe(200);
      const heldStateRespPromise = page.waitForResponse((r) => {
        if (!r.url().includes(API) || r.request().method() !== "POST") return false;
        try { const data = r.request().postDataJSON(); return data !== null && data !== undefined && data.action === "state"; } catch { return false; }
      });
      await heldStateRespPromise;
      await pwExpect(page.locator("#package-editor")).toHaveValue(lateEdit, { timeout: 2000 });
      await pwExpect(page.locator("#approve")).toBeDisabled({ timeout: 2000 });
      await pwExpect(page.locator("#send")).toBeDisabled({ timeout: 2000 });
      expect(heldAdoptCount).toBe(1);
      expect(adoptCount).toBe(2);
      await page.unroute(apiRoute);
      expect(reasonerCalls.length).toBe(1);
      expect(svc.sentBodies().length).toBe(0);
      expect(nonLoopback.length).toBe(0);
    } finally {
      if (page) await page.close();
      if (context) await context.close();
    }
  }, 20000);
});
