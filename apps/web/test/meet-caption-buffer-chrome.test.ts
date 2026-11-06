import { test, expect } from "vitest";
import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createMeetingRoomService } from "../src/meetingRoom.js";
import { createMeetCaptionBuffer } from "../src/meetCaptionBuffer.js";

test("meet caption buffer chrome sample ingest", async () => {
  const target = "https://meet.google.com/abc-defg-hij";
  const html = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head><body><button aria-label=\"Leave call\"></button><div role=\"region\" aria-label=\"Captions\"><div class=\"nMcdL\"><div class=\"adE6rb\"><div class=\"KcIKyf\">Alice</div></div><div class=\"ygicle\">budget is seven hundred dollars</div></div><div class=\"nMcdL\"><div class=\"adE6rb\"><div class=\"KcIKyf\">AI Twin</div></div><div class=\"ygicle\">budget is seven hundred dollars</div></div></div></body></html>";
  const chromePath = process.env.PLAYWRIGHT_CHROME_PATH;
  const launchOptions: Record<string, unknown> = {};
  if (chromePath) launchOptions.executablePath = chromePath;
  else if (existsSync("/usr/bin/google-chrome")) launchOptions.executablePath = "/usr/bin/google-chrome";
  const browser = await chromium.launch(launchOptions as Parameters<typeof chromium.launch>[0]);
  try {
    const page = await browser.newPage();
    await page.route("**/*", async (route) => {
      await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html });
    });
    await page.goto(target);
    const svc = createMeetingRoomService({ env: { SECOND_SEAT_TEST_MODE: "1" }, conversationInput: true });
    const key = randomUUID();
    const opened = svc.open("", { host: "127.0.0.1:4174" }, key);
    const mid: string = opened.view.selectedMeetingId;
    const buffer = createMeetCaptionBuffer({ page, meetingUrl: target, meetingId: mid, signal: new AbortController().signal, isCurrent: () => true });
    const sampled: readonly { event: { version: number; meetingId: string; utteranceId: string; sequence: number; revision: number; speaker: string; text: string }; verified: boolean }[] = await buffer.sample();
    expect(sampled.length).toBe(2);
    expect(Object.isFrozen(sampled)).toBe(true);
    for (const row of sampled) {
      expect(Object.isFrozen(row)).toBe(true);
      expect(Object.isFrozen(row.event)).toBe(true);
    }
    const ids = sampled.map((r) => r.event.utteranceId);
    expect(new Set(ids).size).toBe(2);
    const seqs = sampled.map((r) => r.event.sequence).sort((a, b) => a - b);
    expect(seqs).toEqual([1, 2]);
    for (const row of sampled) {
      expect(row.event.version).toBe(1);
      expect(row.event.meetingId).toBe(mid);
      expect(row.event.revision).toBe(1);
      expect(row.verified).toBe(false);
    }
    const speakers = sampled.map((r) => r.event.speaker).sort();
    expect(speakers).toEqual(["AI Twin", "Alice"]);
    for (const row of sampled) expect(row.event.text).toBe("budget is seven hundred dollars");
    for (const item of sampled) {
      const res = svc.ingestConversationAs(key, opened.roomId, item.event);
      expect(res.status).toBe(200);
    }
    const state = await svc.actAs(key, { roomId: opened.roomId, action: "state" }, { host: "127.0.0.1:4174" });
    const utterances = state.body.snapshot?.conversation?.utterances ?? [];
    expect(utterances.length).toBe(2);
    expect(new Set(utterances.map((u) => u.utteranceId)).size).toBe(2);
    for (const u of utterances) expect(["Alice", "AI Twin"]).toContain(u.speaker);
    for (const u of utterances) expect(u.text).toBe("budget is seven hundred dollars");
    const again = await buffer.sample();
    expect(again.length).toBe(0);
    await page.locator('div.nMcdL').first().locator('div.ygicle').evaluate((el: { textContent: string | null }) => { el.textContent = 'budget is seven hundred fifty dollars'; });
    const correction1 = await buffer.sample();
    expect(correction1.length).toBe(1);
    expect(correction1[0]!.event.utteranceId).toBe(sampled[0]!.event.utteranceId);
    expect(correction1[0]!.event.sequence).toBe(sampled[0]!.event.sequence);
    expect(correction1[0]!.event.revision).toBe(2);
    expect(correction1[0]!.event.text).toBe('budget is seven hundred fifty dollars');
    expect(svc.ingestConversationAs(key, opened.roomId, correction1[0]!.event).status).toBe(200);
    await page.locator('div.nMcdL').first().evaluate((el: { remove: () => void }) => { el.remove(); });
    await page.locator('div[role="region"][aria-label="Captions"]').evaluate((el: { insertAdjacentHTML: (position: string, html: string) => void }) => { el.insertAdjacentHTML('beforeend', '<div class="nMcdL"><div class="adE6rb"><div class="KcIKyf">Alice</div></div><div class="ygicle">budget is seven hundred dollars</div></div>'); });
    const third = await buffer.sample();
    expect(third.length).toBe(1);
    expect(third[0]!.event.sequence).toBe(3);
    expect(third[0]!.event.revision).toBe(1);
    expect(third[0]!.event.utteranceId).not.toBe(sampled[0]!.event.utteranceId);
    expect(third[0]!.event.text).toBe('budget is seven hundred dollars');
    expect(third[0]!.event.speaker).toBe('Alice');
    expect(svc.ingestConversationAs(key, opened.roomId, third[0]!.event).status).toBe(200);
    const state2 = await svc.actAs(key, { roomId: opened.roomId, action: 'state' }, { host: '127.0.0.1:4174' });
    const utterances2 = state2.body.snapshot?.conversation?.utterances ?? [];
    expect(utterances2.length).toBe(3);
    expect(utterances2.map((u) => u.text)).toEqual(['budget is seven hundred fifty dollars', 'budget is seven hundred dollars', 'budget is seven hundred dollars']);
    expect(utterances2.map((u) => u.speaker)).toEqual(['Alice', 'AI Twin', 'Alice']);
  } finally {
    await browser.close();
  }
});

test("meet caption buffer keeps sampling past 256 rows, reads structural rows, and ignores the query string", async () => {
  const target = "https://meet.google.com/abc-defg-hij";
  const html = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head><body><button aria-label=\"Leave call\"></button><div role=\"region\" aria-label=\"Captions\"></div></body></html>";
  const legacy = (n: number): string => "<div class=\"nMcdL\"><div class=\"adE6rb\"><div class=\"KcIKyf\">Alice</div></div><div class=\"ygicle\">line " + String(n) + "</div></div>";
  const structural = (n: number): string => "<div><div><span>Speaker " + String(n) + "</span></div><div>words " + String(n) + "</div></div>";
  const chromePath = process.env.PLAYWRIGHT_CHROME_PATH;
  const launchOptions: { executablePath?: string } = {};
  if (chromePath) launchOptions.executablePath = chromePath;
  else if (existsSync("/usr/bin/google-chrome")) launchOptions.executablePath = "/usr/bin/google-chrome";
  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage();
    await page.route("**/*", async (route) => {
      await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html });
    });
    await page.goto(target + "?authuser=1&hl=en");
    const buffer = createMeetCaptionBuffer({ page, meetingUrl: target, meetingId: "m-rolling", signal: new AbortController().signal, isCurrent: () => true });
    const region = page.locator('div[role="region"][aria-label="Captions"]');
    let total = 0;
    for (let round = 0; round < 20; round++) {
      const parts: string[] = [];
      for (let i = 0; i < 30; i++) parts.push(legacy(round * 30 + i));
      await region.evaluate((el: { innerHTML: string }, h: string) => { el.innerHTML = h; }, parts.join(""));
      const got = await buffer.sample();
      expect(got.length).toBe(30);
      total += got.length;
    }
    expect(total).toBe(600);
    await region.evaluate((el: { innerHTML: string }, h: string) => { el.innerHTML = h; }, structural(1) + structural(2));
    const s = await buffer.sample();
    expect(s.map((r) => [r.event.speaker, r.event.text])).toEqual([["Speaker 1", "words 1"], ["Speaker 2", "words 2"]]);
    expect(s.map((r) => r.event.sequence)).toEqual([601, 602]);
  } finally {
    await browser.close();
  }
}, 30000);
// MSF31: rows appearing (the caption region being replaced) never stop the buffer; the next sample reads them.
test("meet caption buffer keeps sampling when the caption region is replaced as rows appear", async () => {
  const target = "https://meet.google.com/abc-defg-hij";
  const html = "<!DOCTYPE html><html><head><meta charset='utf-8'></head><body><button aria-label='Leave call'></button><div id='host'><div role='region' aria-label='Captions'></div></div></body></html>";
  const chromePath = process.env.PLAYWRIGHT_CHROME_PATH;
  const browser = await chromium.launch(chromePath ? { executablePath: chromePath } : existsSync("/usr/bin/google-chrome") ? { executablePath: "/usr/bin/google-chrome" } : {});
  try {
    const page = await browser.newPage();
    await page.route("**/*", async (route) => { await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }); });
    await page.goto(target);
    const buffer = createMeetCaptionBuffer({ page, meetingUrl: target, meetingId: "abc-defg-hij", signal: new AbortController().signal, isCurrent: () => true });
    expect(await buffer.sample()).toEqual([]);
    await page.setContent("<!DOCTYPE html><html><head><meta charset='utf-8'></head><body><button aria-label='Leave call'></button><div id='host'><div role='region' aria-label='Captions'><div class='nMcdL'><div class='adE6rb'><div class='KcIKyf'>Alice</div></div><div class='ygicle'>hello there</div></div></div></div></body></html>");
    const rows = await buffer.sample();
    expect(rows.length).toBe(1);
    expect(rows[0]?.event.speaker).toBe("Alice");
  } finally {
    await browser.close();
  }
});
