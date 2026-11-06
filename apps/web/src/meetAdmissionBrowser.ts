import type { MeetAdmissionTransport } from "./meetAdmissionProof.js";
export type MeetProofContext<P> = { newPage(): Promise<P> };
export type MeetProofBrowser<P> = { newContext(): Promise<MeetProofContext<P>>; close(): Promise<void> };
export function createMeetAdmissionBrowser<P>(
  scope: { meetingUrl: string; displayName: string },
  deps: {
    launch: () => Promise<MeetProofBrowser<P>>;
    admit: (page: P, scope: Readonly<{ meetingUrl: string; displayName: string }>, signal: AbortSignal) => Promise<boolean>;
  },
): MeetAdmissionTransport {
  const frozenScope = Object.freeze({ meetingUrl: scope.meetingUrl, displayName: scope.displayName });
  const launchFn = deps.launch;
  const admitFn = deps.admit;
  const urlOk = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(frozenScope.meetingUrl);
  const n = frozenScope.displayName;
  const nameOk = n.trim().length > 0 && n.length <= 80 && !/[\x00-\x1F\x7F]/.test(n) && /ai twin/i.test(n) && /\btest\b/i.test(n);
  if (!urlOk || !nameOk) throw new Error("Invalid supervised Meet proof configuration");
  let closed = false;
  let used = false;
  let launchPromise: Promise<MeetProofBrowser<P>> | null = null;
  let cachedCleanup: Promise<void> | null = null;
  let abortSignal: AbortSignal | null = null;
  let abortHandler: (() => void) | null = null;
  const doCleanup = (): Promise<void> => {
    if (cachedCleanup) return cachedCleanup;
    if (!launchPromise) {
      const p = Promise.resolve();
      if (closed) cachedCleanup = p;
      return p;
    }
    cachedCleanup = launchPromise.then(
      (b) => {
        try {
          return Promise.resolve(b.close()).catch(() => { throw new Error("Meet proof cleanup unconfirmed"); });
        } catch {
          throw new Error("Meet proof cleanup unconfirmed");
        }
      },
      () => {}
    );
    return cachedCleanup;
  };
  const leaveImpl = (): Promise<void> => {
    closed = true;
    if (abortSignal && abortHandler) abortSignal.removeEventListener("abort", abortHandler);
    if (cachedCleanup) return cachedCleanup;
    if (!launchPromise) {
      const p = Promise.resolve();
      cachedCleanup = p;
      return p;
    }
    return doCleanup();
  };
  const transport = {
    join(url: string, name: string, signal: AbortSignal): Promise<boolean> {
      if (closed || used || signal.aborted || url !== frozenScope.meetingUrl || name !== frozenScope.displayName) return Promise.resolve(false);
      used = true;
      const onAbort = () => { leaveImpl().catch(() => {}); };
      abortSignal = signal;
      abortHandler = onAbort;
      signal.addEventListener("abort", onAbort, { once: true });
      launchPromise = Promise.resolve().then(() => {
        if (closed || signal.aborted) throw new Error("aborted");
        return launchFn();
      });
      const lp = launchPromise;
      return lp.then((b) => {
        if (closed || signal.aborted) return doCleanup().then(() => false, () => false);
        return b.newContext().then((ctx) => {
          if (closed || signal.aborted) return false;
          return ctx.newPage().then((page) => {
            if (closed || signal.aborted) return false;
            return admitFn(page, frozenScope, signal).then((v) => {
              if (closed || signal.aborted) return false;
              return v;
            }).catch(() => false);
          });
        });
      }).catch(() => false);
    },
    leave(): Promise<void> {
      return leaveImpl();
    },
  };
  return Object.freeze(transport);
}
