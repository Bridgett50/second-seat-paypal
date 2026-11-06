import { test, expect, vi } from "vitest";
import type { Page } from "@playwright/test";
import { createMeetCaptionBuffer } from "../src/meetCaptionBuffer.js";

const CANONICAL = "https://meet.google.com/abc-defg-hij";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

test("isCurrent throw invalidates buffer permanently without DOM access", async () => {
  const getByRole = vi.fn(() => { throw new Error("touched"); });
  const locator = vi.fn(() => { throw new Error("touched"); });
  const fakePage = { getByRole, locator, url: () => CANONICAL } as unknown as Page;
  let valid = false;
  const isCurrent = () => {
    if (!valid) throw new Error("not current");
    return true;
  };
  const buf = createMeetCaptionBuffer({ page: fakePage, meetingUrl: CANONICAL, meetingId: "abc-defg-hij", signal: new AbortController().signal, isCurrent });
  const r1 = await buf.sample();
  expect(r1).toEqual([]);
  expect(Object.isFrozen(r1)).toBe(true);
  expect(getByRole).toHaveBeenCalledTimes(0);
  expect(locator).toHaveBeenCalledTimes(0);
  valid = true;
  const r2 = await buf.sample();
  expect(r2).toEqual([]);
  expect(Object.isFrozen(r2)).toBe(true);
  expect(getByRole).toHaveBeenCalledTimes(0);
  expect(locator).toHaveBeenCalledTimes(0);
});

test("stop during inner count prevents further DOM queries", async () => {
  const d = deferred<number>();
  const countSpy = vi.fn(() => d.promise);
  const isVisibleSpy = vi.fn(() => Promise.resolve(true));
  const locatorSpy = vi.fn(() => { throw new Error("touched"); });
  const fakePage = {
    getByRole: vi.fn(() => ({ count: countSpy, isVisible: isVisibleSpy })),
    locator: locatorSpy,
    url: () => CANONICAL,
  } as unknown as Page;
  const buf = createMeetCaptionBuffer({ page: fakePage, meetingUrl: CANONICAL, meetingId: "abc-defg-hij", signal: new AbortController().signal, isCurrent: () => true });
  const p = buf.sample();
  expect(countSpy).toHaveBeenCalledTimes(1);
  buf.stop();
  d.resolve(1);
  const r = await p;
  expect(r).toEqual([]);
  expect(Object.isFrozen(r)).toBe(true);
  expect(isVisibleSpy).toHaveBeenCalledTimes(0);
  expect(locatorSpy).toHaveBeenCalledTimes(0);
});
