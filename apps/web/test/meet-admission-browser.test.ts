import { expect, it, vi } from "vitest";
import { createMeetAdmissionBrowser } from "../src/meetAdmissionBrowser.js";
import type { MeetProofBrowser } from "../src/meetAdmissionBrowser.js";
type FakePage = { marker: string };
type Deps = {
  launch: () => Promise<MeetProofBrowser<FakePage>>;
  admit: (page: FakePage, scope: Readonly<{ meetingUrl: string; displayName: string }>, signal: AbortSignal) => Promise<boolean>;
};
const validUrl = "https://meet.google.com/abc-defg-hij";
const validName = "Bridgett AI twin (test)";
function makeBrowser(): MeetProofBrowser<FakePage> {
  const page: FakePage = { marker: "p" };
  return {
    newContext: async () => ({ newPage: async () => page }),
    close: vi.fn(async () => {}),
  };
}
function makeDeps(): Deps {
  return {
    launch: async () => makeBrowser(),
    admit: async () => true,
  };
}
it.each([
  { meetingUrl: "https://meet.google.com/bad", displayName: validName },
  { meetingUrl: validUrl, displayName: "Bridgett (test)" },
  { meetingUrl: validUrl, displayName: "Bridgett AI twin" },
])("invalid scope $meetingUrl / $displayName throws before launch", (scope) => {
  const deps = makeDeps();
  const launchSpy = vi.spyOn(deps, "launch");
  expect(() => createMeetAdmissionBrowser(scope, deps)).toThrow();
  expect(launchSpy).toHaveBeenCalledTimes(0);
});
it("leave before join prevents launch", async () => {
  const deps = makeDeps();
  const launchSpy = vi.spyOn(deps, "launch");
  const admitSpy = vi.spyOn(deps, "admit");
  const t = createMeetAdmissionBrowser({ meetingUrl: validUrl, displayName: validName }, deps);
  await t.leave();
  const res = await t.join(validUrl, validName, new AbortController().signal);
  expect(res).toBe(false);
  expect(launchSpy).toHaveBeenCalledTimes(0);
  expect(admitSpy).toHaveBeenCalledTimes(0);
});
it("mutated inputs do not affect captured scope and frozen", async () => {
  const scope = { meetingUrl: validUrl, displayName: validName };
  const deps: Deps = makeDeps();
  let captured: Readonly<{ meetingUrl: string; displayName: string }> | undefined;
  const origAdmit: Deps["admit"] = async (page, s, signal) => {
    captured = s;
    return true;
  };
  deps.admit = origAdmit;
  const origLaunch = vi.spyOn(deps, "launch");
  const t = createMeetAdmissionBrowser(scope, deps);
  scope.meetingUrl = "https://meet.google.com/xxx-yyyy-zzz";
  scope.displayName = "Hacked";
  deps.launch = async () => makeBrowser();
  deps.admit = async () => false;
  const res = await t.join(validUrl, validName, new AbortController().signal);
  expect(res).toBe(true);
  expect(captured?.meetingUrl).toBe(validUrl);
  expect(captured?.displayName).toBe(validName);
  expect(Object.isFrozen(captured)).toBe(true);
  await t.leave();
  expect(origLaunch).toHaveBeenCalledTimes(1);
});

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
it("synchronous abort inside launch before browser resolves cancels admit", async () => {
  const entered = deferred<void>();
  const browserDeferred = deferred<MeetProofBrowser<FakePage>>();
  const controller = new AbortController();
  const browser = makeBrowser();
  const newContextSpy = vi.spyOn(browser, "newContext");
  const deps = makeDeps();
  const admitSpy = vi.spyOn(deps, "admit");
  deps.launch = () => { entered.resolve(); controller.abort(); return browserDeferred.promise; };
  const launchSpy = vi.spyOn(deps, "launch");
  const t = createMeetAdmissionBrowser({ meetingUrl: validUrl, displayName: validName }, deps);
  const joinP = t.join(validUrl, validName, controller.signal);
  await entered.promise;
  browserDeferred.resolve(browser);
  const res = await joinP;
  expect(res).toBe(false);
  await t.leave();
  expect(launchSpy).toHaveBeenCalledTimes(1);
  expect(browser.close).toHaveBeenCalledTimes(1);
  expect(newContextSpy).toHaveBeenCalledTimes(0);
  expect(admitSpy).toHaveBeenCalledTimes(0);
});
it("abort immediately after join before launch runs revokes queued launch", async () => {
  const deps = makeDeps();
  const launchSpy = vi.spyOn(deps, "launch");
  const admitSpy = vi.spyOn(deps, "admit");
  const controller = new AbortController();
  const t = createMeetAdmissionBrowser({ meetingUrl: validUrl, displayName: validName }, deps);
  const joinP = t.join(validUrl, validName, controller.signal);
  controller.abort();
  const res = await joinP;
  await t.leave();
  expect(res).toBe(false);
  expect(launchSpy).toHaveBeenCalledTimes(0);
  expect(admitSpy).toHaveBeenCalledTimes(0);
});
it("sync browser close throw maps to generic cleanup rejection without leak", async () => {
  const browser = makeBrowser();
  const internal = "synthetic-internal-leak-check-xyz";
  vi.spyOn(browser, "close").mockImplementation((): Promise<void> => { throw new Error(internal); });
  const deps = makeDeps();
  deps.launch = async () => browser;
  const t = createMeetAdmissionBrowser({ meetingUrl: validUrl, displayName: validName }, deps);
  const admitted = await t.join(validUrl, validName, new AbortController().signal);
  expect(admitted).toBe(true);
  let firstErr: Error | undefined;
  try { await t.leave(); } catch (e) { if (e instanceof Error) firstErr = e; }
  expect(firstErr).toBeInstanceOf(Error);
  expect(firstErr?.message).toBe("Meet proof cleanup unconfirmed");
  expect(firstErr?.message).not.toContain(internal);
  expect(firstErr?.cause).toBeUndefined();
  let secondErr: Error | undefined;
  try { await t.leave(); } catch (e) { if (e instanceof Error) secondErr = e; }
  expect(secondErr?.message).toBe("Meet proof cleanup unconfirmed");
  expect(secondErr?.cause).toBeUndefined();
  expect(browser.close).toHaveBeenCalledTimes(1);
});
