export type MeetDriverLocator = {
  waitFor(options?: { state?: "attached" | "detached" | "visible" | "hidden"; timeout?: number }): Promise<void>;
  count(): Promise<number>;
  isVisible(): Promise<boolean>;
  click(options?: { timeout?: number; trial?: boolean }): Promise<void>;
  press?(key: string, options?: { timeout?: number }): Promise<void>;
  or(locator: MeetDriverLocator): MeetDriverLocator;
  nth?(index: number): MeetDriverLocator;
  getAttribute?(name: string, options?: { timeout?: number }): Promise<string | null>;
  filter?(options: { visible?: boolean }): MeetDriverLocator;
};
export type MeetDriverPage = {
  goto(url: string, options?: { waitUntil?: "domcontentloaded"; timeout?: number }): Promise<unknown>;
  url(): string;
  getByRole(role: "button" | "link" | "menuitem" | "menuitemradio" | "option", options?: { name?: string | RegExp; exact?: boolean }): MeetDriverLocator;
  getByText(text: string | RegExp, options?: { exact?: boolean }): MeetDriverLocator;
};
// Diagnostic only: mic control labels with anything shaped like an email removed, capped in length.
export function redactMeetMicLabel(label: string): string {
  return label.replace(/[^ <>()]*@[^ <>()]*/g, "[email]").slice(0, 80);
}
// Windows paths use the backslash separator; built from its char code so both separator styles are handled.
const PATH_BACKSLASH = String.fromCharCode(92);
// Last segment of a Windows or POSIX path.
export function meetPathBasename(p: string): string {
  const parts = p.split(PATH_BACKSLASH).join("/").split("/");
  return parts[parts.length - 1] ?? "";
}
// Twin camera: Chrome names the file-backed fake camera "fake_device_N" or after the video file path (live 3:31 PM CT: a C: path to twin.y4m).
// Matches "fake", ".y4m", or the basename of SECOND_SEAT_TWIN_VIDEO, case-insensitive.
export function twinCameraNamePattern(twinVideoPath?: string): RegExp {
  const base = twinVideoPath === undefined ? "" : meetPathBasename(twinVideoPath);
  const safe = /^[A-Za-z0-9._ -]+$/.test(base) ? base.split("").map((c) => (/[A-Za-z0-9 _-]/.test(c) ? c : "[" + c + "]")).join("") : "";
  return new RegExp("fake|[.]y4m" + (safe === "" ? "" : "|" + safe), "i");
}
// Diagnostic only: camera labels with any file path cut to its last segment (no user folders) and emails removed.
export function redactMeetCameraLabel(label: string): string {
  const norm = label.split(PATH_BACKSLASH).join("/");
  const firstSlash = norm.indexOf("/");
  if (firstSlash < 0) return redactMeetMicLabel(norm);
  const wordStart = norm.lastIndexOf(" ", firstSlash) + 1;
  return redactMeetMicLabel(norm.slice(0, wordStart) + ".../" + norm.slice(norm.lastIndexOf("/") + 1));
}
// Twin mode: a mic control whose name says the microphone is not live (never a Turn off microphone control).
export const MEET_MIC_NOT_LIVE = /^(?!turn off microphone)(?=.*mic).*(turn on microphone|microphone is off|problem|blocked|permission|not found|not allowed)/i;
// Playwright locators are strict: isVisible, waitFor and click throw when a locator matches more than one element.
// Narrow to the first visible match so two matching Meet controls never read as "not shown".
export function visibleFirst(l: MeetDriverLocator): MeetDriverLocator {
  if (l.filter === undefined) return l;
  const v = l.filter({ visible: true });
  return v.nth === undefined ? v : v.nth(0);
}
export function ownerAccountNamePattern(email: string): RegExp {
  const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[\\s(<:,])${escaped}($|[\\s)>,])`, "i");
}
export function createAuthenticatedMeetDriver(opts: { expectedOwnerEmail: string; timeoutMs?: number; allowOwnerTransfer?: boolean; ownerSignInTimeoutMs?: number; unrecognizedGraceMs?: number | undefined; cameraMode?: "off" | "twin-image" | undefined; twinVideoPath?: string | undefined; lobbyTimeoutMs?: number | undefined; now?: (() => number) | undefined }) {
  const expectedEmail = opts.expectedOwnerEmail;
  if (typeof expectedEmail !== "string" || expectedEmail.trim() === "" || expectedEmail.length > 320 || /[\x00-\x1F\x7F]/.test(expectedEmail)) {
    throw new Error("invalid expectedOwnerEmail");
  }
  let t = opts.timeoutMs ?? 30000;
  if (!Number.isInteger(t)) t = 30000;
  t = Math.min(60000, Math.max(1000, t));
  const allowTransfer = opts.allowOwnerTransfer === true;
  // twin-image: keep the camera on (fake twin video), never press "Continue without...", and only turn the microphone off.
  const twin = opts.cameraMode === "twin-image";
  const twinCamera = twinCameraNamePattern(opts.twinVideoPath);
  const timeout = t;
  let ownerSignInTimeoutMs = opts.ownerSignInTimeoutMs ?? timeout;
  if (!Number.isFinite(ownerSignInTimeoutMs) || !Number.isInteger(ownerSignInTimeoutMs) || ownerSignInTimeoutMs <= 0) throw new Error("invalid ownerSignInTimeoutMs");
  ownerSignInTimeoutMs = Math.min(300000, ownerSignInTimeoutMs);
  // Ask to join (an external owner account): the lobby wait is capped at 5 minutes and read from an injectable clock.
  const lobbyMs = opts.lobbyTimeoutMs ?? 300000;
  if (!Number.isInteger(lobbyMs) || lobbyMs <= 0 || lobbyMs > 300000) throw new Error("invalid lobbyTimeoutMs");
  const clock = opts.now ?? ((): number => Date.now());
  const graceMs = opts.unrecognizedGraceMs ?? 20000;
  if (!Number.isInteger(graceMs) || graceMs <= 0 || graceMs > 300000) throw new Error("invalid unrecognizedGraceMs");
  const scopeRe = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
  return async (page: MeetDriverPage, scope: Readonly<{ meetingUrl: string; displayName: string }>, signal: AbortSignal): Promise<boolean> => {
    const approvedUrl = scope.meetingUrl;
    if (signal.aborted) return false;
    if (!scopeRe.test(approvedUrl)) return false;
    const approvedCode = new URL(approvedUrl).pathname.slice(1);
    const approvedTarget = new URL(approvedUrl);
  const isApprovedUrl = () => {
    const u = new URL(page.url());
    return u.origin === "https://meet.google.com" && !u.username && !u.password && !u.port && (u.search === approvedTarget.search || (approvedTarget.search === "" && u.search === "?pli=1")) && u.hash === approvedTarget.hash && (u.pathname === `/${approvedCode}` || u.pathname === `/meet/${approvedCode}`);
  };
    const waitOrAbort = (p: Promise<void>): Promise<boolean> => {
      if (signal.aborted) {
        p.catch(() => {});
        return Promise.resolve(false);
      }
      return new Promise<boolean>((resolve) => {
        const onAbort = (): void => {
          signal.removeEventListener("abort", onAbort);
          p.catch(() => {});
          resolve(false);
        };
        signal.addEventListener("abort", onAbort, { once: true });
        p.then(() => {
          signal.removeEventListener("abort", onAbort);
          resolve(true);
        }, () => {
          signal.removeEventListener("abort", onAbort);
          resolve(false);
        });
      });
    };
    // Pre-join failures log one step tag (never an email or caption text); pre-join clicks give up after 5 s.
    let step = "goto";
    const clickMs = 5000;
    const fail = (tag: string): false => { console.warn("[meet-step] failed: " + tag); return false; };
    try {
      const signInUrl = `https://accounts.google.com/ServiceLogin?continue=${encodeURIComponent(approvedUrl)}`;
      await page.goto(signInUrl, { waitUntil: "domcontentloaded", timeout });
      const emailLoc = visibleFirst(page.getByText(expectedEmail, { exact: true }));
      const ownerText = emailLoc;
      const ownerBtn = visibleFirst(page.getByRole("button", { name: ownerAccountNamePattern(expectedEmail) }));
      const cont = visibleFirst(page.getByRole("button", { name: "Continue without microphone and camera", exact: true }));
      const signInBtn = page.getByRole("button", { name: /^\s*sign in\b/i });
      const signInLink = page.getByRole("link", { name: /^\s*sign in\b/i });
      const askBtn = page.getByRole("button", { name: "Ask to join", exact: true });
      const cantJoin = page.getByText(/you can['\u2019]t join this video call/i);
      // Multi-match safe: true when ANY match is visible (never isVisible on a multi-match locator).
      const shown = async (l: MeetDriverLocator): Promise<boolean> => {
        try { const v = visibleFirst(l); return (await v.count()) > 0 && (await v.isVisible()); } catch { return false; }
      };
      const deadline = Date.now() + ownerSignInTimeoutMs;
      let lastSeen = Date.now();
      const firstVisible = (a: MeetDriverLocator, b: MeetDriverLocator, left: number): Promise<void> => {
        const p1 = Promise.resolve().then(() => visibleFirst(a).waitFor({ state: "visible", timeout: left }));
        const p2 = Promise.resolve().then(() => visibleFirst(b).waitFor({ state: "visible", timeout: left }));
        return Promise.any([p1, p2]).then(() => undefined);
      };
      const firstOf = (ls: MeetDriverLocator[], left: number): Promise<number> => Promise.any(ls.map((l, i) => Promise.resolve().then(() => visibleFirst(l).waitFor({ state: "visible", timeout: left })).then(() => i))).catch(() => -1);
      const pause = (ms: number): Promise<boolean> => {
        if (signal.aborted) return Promise.resolve(false);
        return new Promise<boolean>((resolve) => {
          const t = setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve(true);
          }, ms);
          const onAbort = (): void => {
            clearTimeout(t);
            signal.removeEventListener("abort", onAbort);
            resolve(false);
          };
          signal.addEventListener("abort", onAbort, { once: true });
        });
      };
      while (true) {
        if (signal.aborted) return false;
        const left = deadline - Date.now();
        if (left <= 0) return false;
        if (!isApprovedUrl()) lastSeen = Date.now();
        let won = -1;
        await waitOrAbort(firstOf([ownerText, ownerBtn, cont, signInBtn, askBtn, signInLink, cantJoin], Math.min(left, 2000)).then((i) => { won = i; }));
        if (signal.aborted) return false;
        if (await shown(cantJoin)) return false;
        if (won === 0 || won === 1) {
          let vt = false;
          try { vt = await ownerText.isVisible(); } catch { vt = false; }
          let vb = false;
          try { vb = await ownerBtn.isVisible(); } catch { vb = false; }
          if (isApprovedUrl() && (vt || vb)) break;
        } else if (isApprovedUrl()) {
          if (!twin && (await shown(cont))) {
            if (signal.aborted) return false;
            step = "cont.click";
            await cont.click({ timeout: clickMs });
            continue;
          }
          if ((await shown(signInBtn)) || (await shown(signInLink)) || (await shown(askBtn)) || (twin && (await shown(cont)))) lastSeen = Date.now();
          else if (Date.now() - lastSeen >= graceMs) return false;
        }
        const remain = deadline - Date.now();
        if (remain <= 0) return false;
        if (signal.aborted) return false;
        const ms = Math.min(250, Math.max(1, remain));
        const ok = await pause(ms);
        if (!ok) return false;
      }
      if (!isApprovedUrl()) return false;
      try { await Promise.any([Promise.resolve().then(() => visibleFirst(emailLoc.or(cont)).waitFor({ state: "visible", timeout })), Promise.resolve().then(() => ownerBtn.waitFor({ state: "visible", timeout }))]); } catch {}
      if (signal.aborted) return false;
      if (!twin && (await shown(cont))) {
        if (signal.aborted) return false;
        if (!isApprovedUrl()) return fail("urlRecheck");
        step = "cont.click";
        await cont.click({ timeout: clickMs });
      }
      if (!(await waitOrAbort(firstVisible(ownerText, ownerBtn, timeout)))) return fail("ownerCheck");
      let mt = false; try { mt = await ownerText.isVisible(); } catch { mt = false; }
      let mb = false; try { mb = await ownerBtn.isVisible(); } catch { mb = false; }
      if (!mt && !mb) return fail("ownerCheck");
      if (signal.aborted) return false;
      let joinBtn = visibleFirst(page.getByRole("button", { name: "Join now", exact: true }));
      let viaJoinHere = false;
      const switchBtn = visibleFirst(page.getByRole("button", { name: "Switch here", exact: true }));
      const otherWays = visibleFirst(page.getByRole("button", { name: "Other ways to join", exact: true }));
      // An external account (the renamed twin Gmail) gets only "Ask to join"; it is clicked once, after every check below.
      const askJoin = visibleFirst(page.getByRole("button", { name: "Ask to join", exact: true }));
      let askOnly = false;
      step = "joinOptions.wait";
      if (allowTransfer) {
        await visibleFirst(joinBtn.or(switchBtn)).waitFor({ state: "visible", timeout });
      } else {
        // An already expanded join list (Join here too) or a collapsed one (Other ways to join) also counts as ready.
        const joinHereMenu = visibleFirst(page.getByRole("menuitem", { name: "Join here too", exact: true }));
        const joinHereButton = visibleFirst(page.getByRole("button", { name: "Join here too", exact: true }));
        if ((await firstOf([joinBtn, switchBtn, joinHereMenu, joinHereButton, otherWays, askJoin], timeout)) < 0) return fail("joinOptions.wait");
      }
      if (signal.aborted) return false;
      const cont2 = visibleFirst(page.getByRole("button", { name: "Continue without microphone and camera", exact: true }));
      if (!twin && (await shown(cont2))) {
        if (signal.aborted) return false;
        if (!isApprovedUrl()) return fail("urlRecheck");
        step = "cont2.click";
        await cont2.click({ timeout: clickMs });
      }
      if (!(await shown(joinBtn))) {
        if (allowTransfer === true && (await shown(switchBtn))) {
          joinBtn = switchBtn;
        } else if ((await shown(askJoin)) && !(await shown(switchBtn)) && !(await shown(otherWays)) && !(await shown(page.getByRole("menuitem", { name: "Join here too", exact: true }))) && !(await shown(page.getByRole("button", { name: "Join here too", exact: true })))) {
          // Ask-only page: the owner, URL, mic and camera checks below still run before the single Ask to join click.
          askOnly = true;
        } else {
          const joinHere = visibleFirst(page.getByRole("menuitem", { name: "Join here too", exact: true }).or(page.getByRole("button", { name: "Join here too", exact: true })));
          // Meet can show a "Switch the call here" tip over the join list; dismiss only that tip's own "Got it" button.
          const switchTip = page.getByText("Switch the call here", { exact: false });
          const gotIt = page.getByRole("button", { name: "Got it", exact: true });
          if ((await shown(switchTip)) && (await gotIt.count()) === 1 && (await gotIt.isVisible())) {
            if (signal.aborted || !isApprovedUrl()) return false;
            step = "gotIt.click";
            await gotIt.click({ timeout: clickMs });
          }
          if (signal.aborted) return false;
          // Meet can remember the expanded join list ("Show fewer options"); then Join here too is already visible.
          if (!(await shown(joinHere))) {
            if (!(await shown(otherWays))) return fail("joinList");
            if (signal.aborted || !isApprovedUrl()) return false;
            step = "otherWays.click";
            await otherWays.click({ timeout: clickMs });
            if (!(await waitOrAbort(joinHere.waitFor({ state: "visible", timeout })))) return fail("joinHere.wait");
          }
          if (!(await shown(joinHere))) return fail("joinHere.visible");
          if (signal.aborted || !isApprovedUrl()) return false;
          joinBtn = joinHere;
          viaJoinHere = true;
        }
      }
      const micOff = visibleFirst(page.getByRole("button", { name: "Turn off microphone" }));
      const camOff = visibleFirst(page.getByRole("button", { name: "Turn off camera" }));
      // Twin mode needs the camera ON (fake twin video); "Turn on camera" means it is off.
      const camOn = visibleFirst(page.getByRole("button", { name: "Turn on camera" }));
      const micMuted = visibleFirst(page.getByRole("button", { name: /^turn on microphone|microphone.*(blocked|problem|permission needed|not (found|allowed))/i }));
      // With the mic permission blocked, Meet shows the Allow microphone and camera card and its Turn off microphone control is not actionable.
      const micPermission = visibleFirst(page.getByText("Permission needed", { exact: false }));
      const micProblem = visibleFirst(page.getByRole("button", { name: /microphone.*(blocked|problem|permission needed|not (found|allowed))/i }));
      // Never clicked: only read as a "mic blocked" signal.
      const allowAv = visibleFirst(page.getByRole("button", { name: "Allow microphone and camera", exact: true }));
      const avPrompt = visibleFirst(page.getByText("Do you want people to see and hear you?", { exact: false }));
      const micBlocked = async (): Promise<boolean> => (await shown(micPermission)) || (await shown(micProblem)) || (await shown(allowAv)) || (await shown(avPrompt));
      const micNotLive = visibleFirst(page.getByRole("button", { name: MEET_MIC_NOT_LIVE }));
      // On a failed mic-off or camera-on confirmation, log the related control labels (redacted) so the live label can be matched.
      const logMicControls = (): Promise<void> => logControls(/mic/i, "mic");
      const logControls = async (re: RegExp, what: string): Promise<void> => {
        const names: string[] = [];
        try {
          const all = page.getByRole("button", { name: re });
          const n = Math.min(await all.count(), 8);
          for (let i = 0; i < n; i++) {
            if (all.nth === undefined) break;
            const one = all.nth(i);
            const label = one.getAttribute === undefined ? null : await one.getAttribute("aria-label", { timeout: 1000 });
            const muted = one.getAttribute === undefined ? null : await one.getAttribute("data-is-muted", { timeout: 1000 });
            names.push("button:" + redactMeetMicLabel(label ?? "(no aria-label)") + (muted === null ? "" : " muted=" + redactMeetMicLabel(muted)));
          }
        } catch {
          names.push("(unavailable)");
        }
        console.warn("[meet-step] " + what + " controls: " + (names.length === 0 ? "none" : names.join(" | ")));
      };
      // Twin mode: the camera picker must name Chrome's fake capture device (the twin video file), never a real webcam.
      const camDevice = visibleFirst(page.getByRole("button", { name: /^(camera|video)( device)?:/i }));
      const camDeviceLabel = async (): Promise<string | null> => {
        if (!(await shown(camDevice)) || camDevice.getAttribute === undefined) return null;
        try { return await camDevice.getAttribute("aria-label", { timeout: 1000 }); } catch { return null; }
      };
      const logCamDevice = (label: string | null): void => { console.log("[meet-step] camera device: " + (label === null ? "(no camera picker)" : redactMeetCameraLabel(label))); };
      const twinCameraDevice = async (): Promise<boolean> => {
        const label = await camDeviceLabel();
        logCamDevice(label);
        if (label === null || twinCamera.test(label)) return true;
        if (signal.aborted || !isApprovedUrl()) return false;
        step = "camDevice.open";
        await camDevice.click({ timeout: clickMs });
        const fakeItem = visibleFirst(page.getByRole("menuitemradio", { name: twinCamera }).or(page.getByRole("menuitem", { name: twinCamera })).or(page.getByRole("option", { name: twinCamera })));
        if (!(await shown(fakeItem))) return false;
        if (signal.aborted || !isApprovedUrl()) return false;
        step = "camDevice.select";
        await fakeItem.click({ timeout: clickMs });
        const after = await camDeviceLabel();
        logCamDevice(after);
        return after !== null && twinCamera.test(after);
      };
      let micTreatedOff = false;
      const micStillOn = async (): Promise<boolean> => (await shown(micOff)) && !(micTreatedOff && (await micBlocked()));
      if (await shown(micOff)) {
        if (signal.aborted || !isApprovedUrl()) return false;
        if (await micBlocked()) {
          micTreatedOff = true;
        } else {
          step = "micOff.actionable";
          let micReady = false;
          try { await micOff.click({ timeout: 1500, trial: true }); micReady = true; } catch { micReady = false; }
          if (signal.aborted || !isApprovedUrl()) return false;
          if (!micReady && (await micBlocked())) {
            micTreatedOff = true;
          } else {
            step = "micOff.click";
            await micOff.click({ timeout: clickMs });
          }
        }
      }
      if (!twin && (await shown(camOff))) {
        if (signal.aborted || !isApprovedUrl()) return false;
        step = "camOff.click";
        await camOff.click({ timeout: clickMs });
      }
      if (twin && !(await shown(camOff)) && (await shown(camOn))) {
        if (signal.aborted || !isApprovedUrl()) return false;
        step = "camOn.click";
        await camOn.click({ timeout: clickMs });
      }
      if (!(await pause(500))) return false;
      if ((await micStillOn()) || (!twin && (await shown(camOff)))) { await logMicControls(); return fail("micOff.confirm"); }
      if (twin && !(micTreatedOff && (await micBlocked())) && !(await shown(micMuted)) && !(await shown(micNotLive)) && !(!(await shown(micOff)) && (await shown(micPermission)))) { await logMicControls(); return fail("micOff.confirm"); }
      if (twin && !(await shown(camOff))) { await logControls(/camera/i, "camera"); return fail("camOn.confirm"); }
      if (twin && !(await twinCameraDevice())) { await logControls(/camera/i, "camera"); return fail("camera.device"); }
      if (signal.aborted) return false;
      let ft = false; try { ft = await ownerText.isVisible(); } catch { ft = false; }
      let fb = false; try { fb = await ownerBtn.isVisible(); } catch { fb = false; }
      if (signal.aborted) return false;
      if (!ft && !fb) return fail("ownerCheck");
      if (!isApprovedUrl()) return fail("urlRecheck");
      if (askOnly) {
        // Refused, denied or removed: fail fast. Never types a guest name or credentials.
        const lobbyRefused = page.getByText(/can.t join this video call|denied your request|removed from the (call|meeting)|no one responded/i);
        if (signal.aborted) return false;
        if (await shown(lobbyRefused)) return fail("lobby.denied");
        step = "askToJoin.click";
        await askJoin.click({ timeout: clickMs });
        console.log("[meet-step] asked to join; waiting for admission");
        const lobbyLeave = visibleFirst(page.getByRole("button", { name: "Leave call", exact: true }));
        const lobbyUntil = clock() + lobbyMs;
        step = "lobby.wait";
        while (true) {
          if (signal.aborted) return fail("lobby.aborted");
          if (await shown(lobbyRefused)) return fail("lobby.denied");
          if (!isApprovedUrl()) return fail("urlRecheck");
          if (await shown(lobbyLeave)) break;
          if (clock() >= lobbyUntil) return fail("lobby.timeout");
          if (!(await pause(1000))) return fail("lobby.aborted");
        }
      } else if (viaJoinHere) {
        // The "Switch the call here" tip can appear seconds after the join list and cover Join here too.
        // Wait up to 8 s for Join here too to be actionable (trial click) or for the tip's own Got it button.
        const lateTip = page.getByText("Switch the call here", { exact: false });
        const lateGotIt = page.getByRole("button", { name: "Got it", exact: true });
        step = "joinHere.actionable";
        let ready = false;
        const until = Date.now() + 8000;
        while (Date.now() < until) {
          if (signal.aborted) return false;
          try { await joinBtn.click({ timeout: 500, trial: true }); ready = true; } catch { ready = false; }
          if (ready) break;
          if (signal.aborted) return false;
          if ((await shown(lateTip)) && (await lateGotIt.count()) === 1 && (await lateGotIt.isVisible())) {
            if (!isApprovedUrl()) return fail("urlRecheck");
            step = "gotIt.click";
            await lateGotIt.click({ timeout: clickMs });
            step = "joinHere.actionable";
            continue;
          }
          if (!(await pause(250))) return false;
        }
        if (ready) {
          if (signal.aborted) return false;
          if (!isApprovedUrl()) return fail("urlRecheck");
          step = "joinHere.click";
          await joinBtn.click({ timeout: clickMs });
        } else {
          // Enter fallback: only after rechecking the owner, the URL, abort, mic off and that the twin has not already joined.
          if (signal.aborted) return false;
          let et = false; try { et = await ownerText.isVisible(); } catch { et = false; }
          let eb = false; try { eb = await ownerBtn.isVisible(); } catch { eb = false; }
          if (!et && !eb) return fail("ownerCheck");
          if (!isApprovedUrl()) return fail("urlRecheck");
          if ((await micStillOn()) || (!twin && (await shown(camOff)))) { await logMicControls(); return fail("micOff.confirm"); }
          if (twin && !(await shown(camOff))) { await logControls(/camera/i, "camera"); return fail("camOn.confirm"); }
          const leaveNow = visibleFirst(page.getByRole("button", { name: "Leave call", exact: true }));
          if (!(await shown(leaveNow))) {
            if (signal.aborted) return false;
            if (joinBtn.press === undefined) return fail("joinHere.enter");
            step = "joinHere.enter";
            await joinBtn.press("Enter", { timeout: clickMs });
          }
        }
      } else {
        step = "joinHere.click";
        await joinBtn.click({ timeout: clickMs });
      }
      const leaveBtn = visibleFirst(page.getByRole("button", { name: "Leave call", exact: true }));
      step = "leave.wait";
      await leaveBtn.waitFor({ state: "visible", timeout });
      if (signal.aborted) return false;
      if (!isApprovedUrl()) return false;
      return await leaveBtn.isVisible();
    } catch (e) {
      // Only the step tag and the error name are logged; the error message could contain an email.
      return fail(step + " (" + (e instanceof Error ? e.name : "unknown") + ")");
    }
  };
}
// Guest join: the twin joins as a visible guest named as an AI twin, and the owner admits it from the lobby.
export const DEFAULT_MEET_GUEST_NAME = "Bridgett's AI twin";
export function resolveMeetGuestName(name?: string): string {
  const n = name === undefined || name.trim() === "" ? DEFAULT_MEET_GUEST_NAME : name.trim();
  if (n.length > 60) throw new Error("Meet guest name is too long");
  for (let i = 0; i < n.length; i++) { const c = n.charCodeAt(i); if (c < 32 || c === 127) throw new Error("Meet guest name has a control character"); }
  if (!n.toLowerCase().includes("ai twin")) throw new Error("Meet guest name must say AI twin");
  return n;
}
export type MeetGuestLocator = {
  waitFor(options?: { state?: "attached" | "detached" | "visible" | "hidden"; timeout?: number }): Promise<void>;
  isVisible(): Promise<boolean>;
  click(): Promise<void>;
  fill(value: string): Promise<void>;
};
export type MeetGuestPage = {
  goto(url: string, options?: { waitUntil?: "domcontentloaded"; timeout?: number }): Promise<unknown>;
  url(): string;
  getByRole(role: "button" | "textbox", options: { name: string | RegExp; exact?: boolean }): MeetGuestLocator;
  getByText(text: RegExp): MeetGuestLocator;
};
// Opens the approved meeting link directly (no Google sign-in), types the guest name, keeps the microphone and camera off,
// clicks only "Ask to join", then waits in the lobby until the owner admits it. It never clicks Join now, Switch here, Sign in or Gemini.
export function createGuestMeetDriver(opts: { guestName?: string; timeoutMs?: number; lobbyTimeoutMs?: number }) {
  const guestName = resolveMeetGuestName(opts.guestName);
  const timeout = opts.timeoutMs ?? 30000;
  if (!Number.isInteger(timeout) || timeout <= 0 || timeout > 60000) throw new Error("invalid timeoutMs");
  const lobbyMs = opts.lobbyTimeoutMs ?? 300000;
  if (!Number.isInteger(lobbyMs) || lobbyMs <= 0 || lobbyMs > 600000) throw new Error("invalid lobbyTimeoutMs");
  return async (page: MeetGuestPage, scope: Readonly<{ meetingUrl: string; displayName: string }>, signal: AbortSignal): Promise<boolean> => {
    if (signal.aborted) return false;
    let target: URL;
    try { target = new URL(scope.meetingUrl); } catch { return false; }
    const code = target.pathname.slice(1);
    if (target.href !== scope.meetingUrl || target.origin !== "https://meet.google.com" || target.username !== "" || target.password !== "" || target.search !== "" || target.hash !== "" || !/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(code)) return false;
    const onMeet = (): boolean => {
      try { const u = new URL(page.url()); return u.origin === "https://meet.google.com" && u.username === "" && u.password === "" && (u.pathname === "/" + code || u.pathname === "/meet/" + code); } catch { return false; }
    };
    const shown = async (l: MeetGuestLocator): Promise<boolean> => {
      try { return await l.isVisible(); } catch { return false; }
    };
    // Index of the first locator that becomes visible, or -1 on timeout or abort.
    const firstOf = (ls: MeetGuestLocator[], ms: number): Promise<number> => {
      if (signal.aborted) return Promise.resolve(-1);
      return new Promise<number>((done) => {
        const onAbort = (): void => { done(-1); };
        signal.addEventListener("abort", onAbort, { once: true });
        Promise.any(ls.map((l, i) => Promise.resolve().then(() => l.waitFor({ state: "visible", timeout: ms })).then(() => i))).then(
          (i) => { signal.removeEventListener("abort", onAbort); done(i); },
          () => { signal.removeEventListener("abort", onAbort); done(-1); }
        );
      });
    };
    const refused = page.getByText(/can.t join this video call|denied your request|removed from the (call|meeting)|no one responded/i);
    try {
      await page.goto(scope.meetingUrl, { waitUntil: "domcontentloaded", timeout });
      if (signal.aborted || !onMeet()) return false;
      const nameBox = page.getByRole("textbox", { name: /your name/i });
      if ((await firstOf([nameBox, refused], timeout)) !== 0) return false;
      if (signal.aborted || (await shown(refused)) || !onMeet()) return false;
      await nameBox.fill(guestName);
      const micOff = page.getByRole("button", { name: "Turn off microphone", exact: true });
      const camOff = page.getByRole("button", { name: "Turn off camera", exact: true });
      for (const l of [micOff, camOff]) {
        if (!(await shown(l))) continue;
        if (signal.aborted || !onMeet()) return false;
        await l.click();
        await l.waitFor({ state: "hidden", timeout });
      }
      if ((await shown(micOff)) || (await shown(camOff))) return false;
      const askBtn = page.getByRole("button", { name: "Ask to join", exact: true });
      if ((await firstOf([askBtn, refused], timeout)) !== 0) return false;
      if (signal.aborted || (await shown(refused)) || !onMeet()) return false;
      await askBtn.click();
      const leaveBtn = page.getByRole("button", { name: "Leave call", exact: true });
      if ((await firstOf([leaveBtn, refused], lobbyMs)) !== 0) return false;
      if (signal.aborted || (await shown(refused)) || !onMeet()) return false;
      return await shown(leaveBtn);
    } catch {
      return false;
    }
  };
}
