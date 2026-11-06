import { test, expect, vi } from "vitest";
import type { Page } from "@playwright/test";
import { join, resolve } from "node:path";
import type { MeetProofBrowser } from "./../src/meetAdmissionBrowser.js";
import { createLocalMeetCaptureFactory, MeetCaptureStartError, enableMeetCaptions, type MeetCaptionsPage, meetChromeArgs, meetPermissionGrants, launchAttachedMeetChrome, defaultMeetChromePath, resolveMeetProfileDir, meetCaptureOptsFromEnv, type AttachedChild, type AttachedBrowser } from "../src/meetWorkerCapture.js";
import { collectMeetUiDiagnostic, MEET_CAPTION_REGION_SELECTOR, MEET_CAPTION_REGION_ALT_SELECTOR } from "../src/meetCaptionReader.js";

type D<T>={promise:Promise<T>;resolve:(v:T)=>void;reject:(e:unknown)=>void};
function deferred<T>():D<T>{let r!:D<T>["resolve"],j!:D<T>["reject"];const p=new Promise<T>((a,b)=>{r=a;j=b});return{promise:p,resolve:r,reject:j}}
const URL_S="https://meet.google.com/abc-defg-hij";
const DISPLAY="Second Seat AI twin (test)";
const BIND={roomId:"r1",ownerId:"owner-123",meetingId:"m1",epoch:1} as const;
function fakePage(){
  const getByRole=vi.fn(()=>({count:async()=>0}));
  const locator=vi.fn(()=>({count:async()=>0}));
  return {url:()=>URL_S,getByRole,locator} as unknown as Page;
}
function mkBrowser(fake:Page,closeImpl?:()=>Promise<void>){
  const close=vi.fn(closeImpl??(async()=>{}));
  const newPage=vi.fn(async()=>fake);
  const newContext=vi.fn(async()=>({newPage} as unknown));
  const browser={newContext,close} as unknown as MeetProofBrowser<Page>;
  return {browser,close,newContext,newPage,fake};
}
function scope(isCurrent:()=>boolean){return{meetingUrl:URL_S,displayName:DISPLAY,binding:BIND as unknown as typeof BIND,isCurrent}}
test("1 pre-aborted and isCurrent false/throw rejects generic and no launch",async()=>{
  {
    const launch=vi.fn(async()=>mkBrowser(fakePage()).browser);
    const factory=createLocalMeetCaptureFactory({expectedOwnerEmail:"owner@example.test",launch});
    const ac=new AbortController();ac.abort();
    await expect(factory(scope(()=>true),ac.signal)).rejects.toSatisfy((e:unknown)=>e instanceof MeetCaptureStartError && (e as Error).message==="Meet capture unavailable" && (e as MeetCaptureStartError).cleanupConfirmed===true);
    expect(launch).not.toHaveBeenCalled();
  }
  {
    const launch=vi.fn(async()=>mkBrowser(fakePage()).browser);
    const factory=createLocalMeetCaptureFactory({expectedOwnerEmail:"owner@example.test",launch});
    const ac=new AbortController();
    await expect(factory(scope(()=>false),ac.signal)).rejects.toSatisfy((e:unknown)=>e instanceof MeetCaptureStartError && (e as Error).message==="Meet capture unavailable" && (e as MeetCaptureStartError).cleanupConfirmed===true);
    expect(launch).not.toHaveBeenCalled();
  }
  {
    const launch=vi.fn(async()=>mkBrowser(fakePage()).browser);
    const factory=createLocalMeetCaptureFactory({expectedOwnerEmail:"owner@example.test",launch});
    const ac=new AbortController();
    await expect(factory(scope(()=>{throw new Error("x")}),ac.signal)).rejects.toSatisfy((e:unknown)=>e instanceof MeetCaptureStartError && (e as Error).message==="Meet capture unavailable" && (e as MeetCaptureStartError).cleanupConfirmed===true);
    expect(launch).not.toHaveBeenCalled();
  }
});
test("2 pending launch external abort holds close",async()=>{
  const fp=fakePage();
  const entered=deferred<void>();const closeBarrier=deferred<void>();
  const launchD=deferred<MeetProofBrowser<Page>>();
  const b=mkBrowser(fp,async()=>{entered.resolve();await closeBarrier.promise});
  const launch=vi.fn(()=>{return launchD.promise});
  const factory=createLocalMeetCaptureFactory({expectedOwnerEmail:"owner@example.test",launch});
  const ac=new AbortController();
  let settled=false;
  const p=factory(scope(()=>true),ac.signal).then(()=>{settled=true;throw new Error("ok")},e=>{settled=true;throw e});
  p.catch(()=>{});
  await Promise.resolve();
  ac.abort();
  launchD.resolve(b.browser);
  await entered.promise;
  expect(settled).toBe(false);
  expect(b.close).toHaveBeenCalledTimes(1);
  expect(b.newContext).not.toHaveBeenCalled();
  closeBarrier.resolve();
  await expect(p).rejects.toSatisfy((e:unknown)=>e instanceof MeetCaptureStartError && (e as Error).message==="Meet capture unavailable");
  expect(b.close).toHaveBeenCalledTimes(1);
});
test("3 authority false while admit pending rejects and no captions",async()=>{
  const fp=fakePage();const b=mkBrowser(fp);
  const admitEntered=deferred<void>();const admitD=deferred<boolean>();
  const admit=vi.fn(async(_p:Page,_s:unknown,_sig:AbortSignal)=>{admitEntered.resolve();return admitD.promise});
  const enableCaptions=vi.fn(async()=>true);
  let cur=true;
  const factory=createLocalMeetCaptureFactory({expectedOwnerEmail:"owner@example.test",launch:async()=>b.browser,admit,enableCaptions});
  const p=factory(scope(()=>cur),new AbortController().signal);
  p.catch(()=>{});
  await admitEntered.promise;
  cur=false;
  admitD.resolve(true);
  await expect(p).rejects.toSatisfy((e:unknown)=>e instanceof MeetCaptureStartError && (e as Error).message==="Meet capture unavailable" && (e as MeetCaptureStartError).cleanupConfirmed===true);
  expect(enableCaptions).not.toHaveBeenCalled();
  expect(b.close).toHaveBeenCalledTimes(1);
});
test("4 success sample/stop caching and no reads after stop",async()=>{
  const fp=fakePage();const b=mkBrowser(fp);
  const order:string[]=[];
  let capturedSig:AbortSignal|null=null;
  let isCurrentSeen=false;
  const admit=vi.fn(async(_p:Page,_s:unknown,sig:AbortSignal)=>{order.push("admit");capturedSig=sig;return true});
  let sigEq=false;const enableCaptions=vi.fn(async(_p:Page,sig:AbortSignal,isCurrent:()=>boolean)=>{order.push("captions");isCurrentSeen=isCurrent();sigEq=sig===capturedSig;return true});
  // need helper to use real buffer before stop: createMeetCaptionBuffer uses reader
  const closeEntered=deferred<void>();const closeAck=deferred<void>();
  const b2=mkBrowser(fp,async()=>{closeEntered.resolve();await closeAck.promise});
  const factory=createLocalMeetCaptureFactory({expectedOwnerEmail:"owner@example.test",launch:async()=>b2.browser,admit,enableCaptions});
  const h=await factory(scope(()=>true),new AbortController().signal);
  expect(order).toEqual(["admit","captions"]);
  expect(isCurrentSeen).toBe(true);
  expect(sigEq).toBe(true);
  const r1=await h.sample();expect(r1).toEqual([]);
  expect(fp.getByRole).toHaveBeenCalled();
  const readsBefore=(fp.getByRole as unknown as {mock:{calls:unknown[]}}).mock.calls.length;
  const s1=h.stop();const s2=h.stop();
  expect(s1).toBe(s2);
  let ack=false;s1.then(()=>ack=true,s=>{ack=false});
  await closeEntered.promise;
  // sample after stop must be immediate [] with 0 additional DOM reads
  const after=await h.sample();expect(after).toEqual([]);
  expect((fp.getByRole as unknown as {mock:{calls:unknown[]}}).mock.calls.length).toBe(readsBefore);
  expect(ack).toBe(false);
  expect(b2.close).toHaveBeenCalledTimes(1);
  closeAck.resolve();await s1;
  expect(ack).toBe(true);
});
test("5 browser close failure on stop rejects cleanup unconfirmed",async()=>{
  const fp=fakePage();const b=mkBrowser(fp,async()=>{throw "internal"});
  const factory=createLocalMeetCaptureFactory({expectedOwnerEmail:"owner@example.test",launch:async()=>b.browser,admit:async()=>true,enableCaptions:async()=>true});
  const h=await factory(scope(()=>true),new AbortController().signal);
  const p1=h.stop();const p2=h.stop();
  expect(p1).toBe(p2);
  await expect(p1).rejects.toSatisfy((e:unknown)=>e instanceof Error && (e as Error).message==="Meet proof cleanup unconfirmed" && !String(e).includes("internal"));
  await expect(p2).rejects.toMatchObject({message:"Meet proof cleanup unconfirmed"});
  expect(b.close).toHaveBeenCalledTimes(1);
});
test("6 external abort while captions helper pending",async()=>{
  const fp=fakePage();const b=mkBrowser(fp);
  const helperEntered=deferred<void>();const helperD=deferred<boolean>();
  const admit=vi.fn(async()=>true);
  const enableCaptions=vi.fn(async(_p:Page,_sig:AbortSignal,_ic:()=>boolean)=>{helperEntered.resolve();return helperD.promise});
  const ac=new AbortController();
  const factory=createLocalMeetCaptureFactory({expectedOwnerEmail:"owner@example.test",launch:async()=>b.browser,admit,enableCaptions});
  const p=factory(scope(()=>true),ac.signal);p.catch(()=>{});
  await helperEntered.promise;
  // capture that helper uses not invented proof.phase but real isCurrent/signal path via abort
  const readsBefore=(fp.getByRole as unknown as {mock:{calls:unknown[]}}).mock.calls.length;
  ac.abort();
  helperD.resolve(true);
  await expect(p).rejects.toSatisfy((e:unknown)=>e instanceof MeetCaptureStartError && (e as Error).message==="Meet capture unavailable");
  expect(b.close).toHaveBeenCalledTimes(1);
  expect((fp.getByRole as unknown as {mock:{calls:unknown[]}}).mock.calls.length).toBe(readsBefore);
});
test("7 admit false + close throws => class false",async()=>{
  const fp=fakePage();const b=mkBrowser(fp,async()=>{throw "internal"});
  const factory=createLocalMeetCaptureFactory({expectedOwnerEmail:"owner@example.test",launch:async()=>b.browser,admit:async()=>false});
  await expect(factory(scope(()=>true),new AbortController().signal)).rejects.toSatisfy((e:unknown)=>e instanceof MeetCaptureStartError && (e as MeetCaptureStartError).cleanupConfirmed===false && (e as Error).message==="Meet proof cleanup unconfirmed" && !(e as Error).cause);
});
test("8 sticky isCurrent false then true still fails",async()=>{
  const fp=fakePage();const b=mkBrowser(fp);
  let cur=true;
  let capturedFalse=false;
  const enableCaptions=async(_p:Page,_s:AbortSignal,isCurrent:()=>boolean)=>{
    const before=isCurrent();
    if(before===false) capturedFalse=true;
    cur=false;
    const seen=isCurrent();
    if(seen===false) capturedFalse=true;
    cur=true;
    return true;
  };
  const factory=createLocalMeetCaptureFactory({expectedOwnerEmail:"owner@example.test",launch:async()=>b.browser,admit:async()=>true,enableCaptions:enableCaptions as unknown as (p:Page,s:AbortSignal,ic:()=>boolean)=>Promise<boolean>});
  const isCurrent=()=>cur;
  await expect(factory(scope(isCurrent),new AbortController().signal)).rejects.toSatisfy((e:unknown)=>e instanceof MeetCaptureStartError && (e as MeetCaptureStartError).cleanupConfirmed===true);
  expect(capturedFalse).toBe(true);
  expect(b.close).toHaveBeenCalledTimes(1);
});

test("9 readiness modal forces decline before identity", async()=>{
  const exp="owner@example.test";
  for(const mode of ["owner","wrong","abort"] as const){
    const entered=deferred<void>(),reveal=deferred<void>();
    let modal=false,declined=false,verified=false,jc=0,dc=0,done=false,home=false;
    const goto=vi.fn(async(u:string,_o?:unknown)=>{home=u==="https://meet.google.com/";});
    const failOwnerBtn = ():L => ({ count: async () => 0, isVisible: async () => false, waitFor: async () => { throw new Error("hidden"); }, click: async () => {}, or(o:L){ return failOwnerBtn(); } });
    const pend=(a:()=>Promise<void>)=> done? a(): (done=true,entered.resolve(undefined),reveal.promise.then(a));
    type L={count:()=>Promise<number>,isVisible:()=>Promise<boolean>,waitFor:()=>Promise<void>,click:()=>Promise<void>,or:(o:L)=>L};
    const mk=(k:string):L=>({count:async()=>k==="hw"? (home?0:modal&&!declined?1:0):k==="join"? (declined&&verified&&mode==="owner"?1:0):k==="leave"? (jc?1:0):0,isVisible:async()=>k==="hw"? (!home&&modal&&!declined):k==="owner"? (home?mode!=="wrong":declined&&verified&&mode==="owner"):k==="join"? (declined&&verified&&mode==="owner"):k==="leave"? !!jc:false,waitFor:async()=>pend(async()=>{if(k==="owner"){if(home){if(mode==="wrong") throw new Error("hidden");}else{if(mode==="wrong"||!declined) throw new Error("hidden");verified=true;}}else if(k==="hw"){if(home||!modal||declined) throw new Error("hidden");}else if(k==="join"){if(!declined||!verified||mode!=="owner") throw new Error("hidden");}else if(k==="leave"){if(!jc) throw new Error("hidden");}}),click:async()=>{if(k==="hw"){declined=true;modal=false;dc++;}else if(k==="join"){if(!verified) throw new Error("forbidden");jc++;}},or(o:L){const u=mk(k+"|or");u.waitFor=async()=>pend(async()=>{if(!modal) throw new Error("hidden")});return u;}});
    const owner=mk("owner"),hw=mk("hw"),join=mk("join"),leave=mk("leave"),dum=mk("dum");
    const fake={goto,url:()=>home?"https://meet.google.com/":URL_S,getByText:vi.fn((t:string)=>t===exp?owner:dum),getByRole:vi.fn((r:string,o:{name?:string|RegExp})=>o?.name==="Continue without microphone and camera"?hw:o?.name==="Join now"?join:o?.name==="Leave call"?leave:(o?.name instanceof RegExp&&o.name.test(exp))?failOwnerBtn():dum)} as unknown as Page;
    const b=mkBrowser(fake as unknown as Page);const enableCaptions=vi.fn(async()=>true);
    const factory=createLocalMeetCaptureFactory({expectedOwnerEmail:exp,launch:async()=>b.browser,enableCaptions,ownerUnrecognizedGraceMs:100});
    const ac=new AbortController();const p=factory(scope(()=>true),ac.signal);p.catch(()=>{});
    await entered.promise;if(mode==="abort") ac.abort();modal=true;reveal.resolve(undefined);
    let h:Awaited<ReturnType<typeof factory>>|null=null,err:unknown=null;try{h=await p;}catch(e){err=e;}
    try{
      if(mode==="owner"){expect(err).toBeNull();expect(dc).toBe(1);expect(jc).toBe(1);expect(verified).toBe(true);expect(enableCaptions).toHaveBeenCalledTimes(1);expect(goto.mock.calls.map(c=>c[0])).toEqual([`https://accounts.google.com/ServiceLogin?continue=${encodeURIComponent(URL_S)}`]);}
      else {expect(err).toBeInstanceOf(MeetCaptureStartError);expect((err as MeetCaptureStartError).cleanupConfirmed).toBe(true);expect(jc).toBe(0);expect(enableCaptions).not.toHaveBeenCalled();if(mode==="abort") expect(dc).toBe(0);else expect(goto.mock.calls.map(c=>c[0])).toEqual([`https://accounts.google.com/ServiceLogin?continue=${encodeURIComponent(URL_S)}`]);}
    }finally{if(h) await h.stop();expect(b.close).toHaveBeenCalledTimes(1);}
  }
});

type FL = { count(): Promise<number>; isVisible(): Promise<boolean>; click(): Promise<void>; waitFor(o: { state: "visible"; timeout: number }): Promise<void>; getAttribute(n: string): Promise<string | null>; or(o: FL): FL; nth(i: number): FL };
function capPage(init: { chip?: { role: string; attr: string; on: boolean }; oldUi?: boolean; regionOn?: boolean; noRegion?: boolean; directToggle?: boolean; gotIt?: boolean }): { page: MeetCaptionsPage; clicks: string[]; asked: string[] } {
  const clicks: string[] = [];
  const asked: string[] = [];
  let regionOn = init.regionOn === true;
  let menuOpen = false;
  let gotItOn = init.gotIt === true;
  const chip = init.chip;
  const orL = (a: FL, b: FL): FL => {
    const l: FL = {
      count: async () => (await a.count()) + (await b.count()),
      isVisible: async () => (await a.isVisible()) || (await b.isVisible()),
      click: async () => { if (await a.isVisible()) await a.click(); else await b.click(); },
      waitFor: async () => { if (!(await a.isVisible()) && !(await b.isVisible())) throw new Error("timeout"); },
      getAttribute: async (n: string) => ((await a.count()) > 0 ? a.getAttribute(n) : b.getAttribute(n)),
      or: (o: FL) => orL(l, o),
      nth: (i: number) => lazy(async () => { const ac = await a.count(); return i < ac ? a.nth(i) : b.nth(i - ac); }),
    };
    return l;
  };
  const lazy = (get: () => Promise<FL>): FL => {
    const l: FL = {
      count: async () => (await get()).count(),
      isVisible: async () => (await get()).isVisible(),
      click: async () => (await get()).click(),
      waitFor: async (o: { state: "visible"; timeout: number }) => (await get()).waitFor(o),
      getAttribute: async (n: string) => (await get()).getAttribute(n),
      or: (o: FL) => orL(l, o),
      nth: (i: number) => (i === 0 ? l : loc("none", () => false)),
    };
    return l;
  };
  const loc = (key: string, vis: () => boolean, attrs: () => Record<string, string> = () => ({}), onClick: () => void = () => {}): FL => {
    const l: FL = {
      count: async () => (vis() ? 1 : 0),
      isVisible: async () => vis(),
      click: async () => { clicks.push(key); onClick(); },
      waitFor: async () => { if (!vis()) throw new Error("timeout"); },
      getAttribute: async (n: string) => attrs()[n] ?? null,
      or: (o: FL) => orL(l, o),
      nth: (i: number) => (i === 0 ? l : loc(key + "#" + String(i), () => false)),
    };
    return l;
  };
  const page: MeetCaptionsPage = {
    getByRole(role: "button" | "checkbox" | "switch" | "region", options: { name: string | RegExp; exact?: boolean }) {
      const name = options.name;
      asked.push(role + ":" + String(name));
      if (role === "region" && name === "Captions") return loc("region:Captions", () => init.oldUi === true && regionOn);
      if (name instanceof RegExp) {
        if (chip && role === chip.role && name.test("Live captions")) return loc("chip:Live captions", () => true, () => ({ [chip.attr]: chip.on ? "true" : "false" }), () => { chip.on = true; regionOn = true; });
        return loc(role + ":?", () => false);
      }
      if (name === "Captions and translation") return loc(role + ":" + name, () => init.oldUi === true && role === "button", () => ({}), () => { if (init.directToggle === true) regionOn = true; else menuOpen = true; });
      if (name === "Let Gemini take notes" || name === "Translate speech") return loc(role + ":" + name, () => true);
      if (name === "Got it") return loc(role + ":" + name, () => gotItOn && role === "button", () => ({}), () => { gotItOn = false; });
      return loc(role + ":" + name, () => false);
    },
    getByText(text: string) {
      return loc("text:" + text, () => text === "Turn on captions" && menuOpen, () => ({}), () => { regionOn = true; });
    },
    locator(selector: string) {
      if (selector === MEET_CAPTION_REGION_SELECTOR) return loc("css:old-region", () => init.oldUi === true && regionOn);
      if (selector === MEET_CAPTION_REGION_ALT_SELECTOR) return loc("css:alt-region", () => init.oldUi !== true && regionOn && init.noRegion !== true);
      return loc("css:" + selector, () => false);
    },
  };
  return { page, clicks, asked };
}
test("captions: Live captions chip that is off is clicked exactly once", async () => {
  const f = capPage({ chip: { role: "button", attr: "aria-pressed", on: false } });
  const onFail = vi.fn(async () => {});
  expect(await enableMeetCaptions(f.page, new AbortController().signal, () => true, onFail)).toBe(true);
  expect(f.clicks).toEqual(["chip:Live captions"]);
  expect(onFail).not.toHaveBeenCalled();
});
test("captions: Live captions chip that is already on is not clicked", async () => {
  const f = capPage({ chip: { role: "switch", attr: "aria-checked", on: true }, regionOn: true });
  expect(await enableMeetCaptions(f.page, new AbortController().signal, () => true)).toBe(true);
  expect(f.clicks).toEqual([]);
});
test("captions: old Captions and translation path still works when there is no chip", async () => {
  const f = capPage({ oldUi: true });
  expect(await enableMeetCaptions(f.page, new AbortController().signal, () => true)).toBe(true);
  expect(f.clicks).toEqual(["button:Captions and translation", "text:Turn on captions"]);
});
test("captions: Captions and translation that turns captions on directly succeeds without Turn on captions", async () => {
  const f = capPage({ oldUi: true, directToggle: true });
  const onFail = vi.fn(async () => {});
  expect(await enableMeetCaptions(f.page, new AbortController().signal, () => true, onFail)).toBe(true);
  expect(f.clicks).toEqual(["button:Captions and translation"]);
  expect(onFail).not.toHaveBeenCalled();
});
test("captions: an onboarding Got it tip is dismissed first, then the old path turns captions on", async () => {
  const f = capPage({ oldUi: true, gotIt: true });
  expect(await enableMeetCaptions(f.page, new AbortController().signal, () => true)).toBe(true);
  expect(f.clicks).toEqual(["button:Got it", "button:Captions and translation", "text:Turn on captions"]);
});
test("captions: Captions region already visible returns true without clicking", async () => {
  const f = capPage({ oldUi: true, regionOn: true });
  expect(await enableMeetCaptions(f.page, new AbortController().signal, () => true)).toBe(true);
  expect(f.clicks).toEqual([]);
});
test("captions: Gemini and Translate are never clicked or looked up; failure runs the diagnostic once", async () => {
  const f = capPage({ chip: { role: "checkbox", attr: "aria-checked", on: true }, noRegion: true });
  const onFail = vi.fn(async () => {});
  expect(await enableMeetCaptions(f.page, new AbortController().signal, () => true, onFail)).toBe(false);
  expect(f.clicks).toEqual([]);
  expect(f.asked.some((a) => /gemini|translate/i.test(a))).toBe(false);
  expect(onFail).toHaveBeenCalledTimes(1);
});
test("captions: diagnostic lists only role and name, redacts emails, and skips caption text", async () => {
  const el = (label: string | null, text: string) => ({ getAttribute: async () => label, innerText: async () => text });
  const page = {
    locator(selector: string) {
      if (selector.includes('"button"')) return { all: async () => [el("Google Account: Owner (owner@example.test)", "Owner owner@example.test"), el(null, "Live captions\nmore")] };
      if (selector.includes('"switch"')) return { all: async () => [el("Translate speech", "")] };
      if (selector.includes('"region"')) return { all: async () => [el("Captions", "Alice: secret caption words"), el(null, "Bob: another secret caption")] };
      return { all: async () => [] };
    },
  };
  const out = await collectMeetUiDiagnostic(page);
  expect(out).toContain("button: Live captions");
  expect(out).toContain("button: Google Account: Owner ([email])");
  expect(out).toContain("switch: Translate speech");
  expect(out).toContain("region: Captions");
  expect(out).toContain("region: (unnamed)");
  expect(out).not.toContain("@");
  expect(out).not.toContain("secret caption");
});
function preOnPage(o: { regionAttached: boolean; settings: boolean; attachOnToggle: boolean }): { page: MeetCaptionsPage; clicks: string[] } {
  const clicks: string[] = [];
  let attached = o.regionAttached;
  const loc = (key: string, n: () => number, vis: () => boolean, onClick: () => void = () => {}): FL => {
    const l: FL = {
      count: async () => n(),
      isVisible: async () => vis(),
      click: async () => { clicks.push(key); onClick(); },
      waitFor: async () => { if (n() === 0) throw new Error("timeout"); },
      getAttribute: async () => null,
      or: () => l,
      nth: () => l,
    };
    return l;
  };
  const page: MeetCaptionsPage = {
    getByRole(role: "button" | "checkbox" | "switch" | "region", options: { name: string | RegExp; exact?: boolean }) {
      const name = options.name;
      if (role === "region" && name === "Captions") return loc("region:Captions", () => (attached ? 1 : 0), () => false);
      if (name instanceof RegExp) return loc(role + ":?", () => 0, () => false);
      if (role === "button" && (name === "Open caption settings" || name === "Jump to most recent captions")) return loc(role + ":" + name, () => (o.settings ? 1 : 0), () => o.settings);
      if (role === "button" && (name === "Captions and translation" || name === "Let Gemini take notes" || name === "Translate speech")) return loc(role + ":" + name, () => 1, () => true, () => { if (name === "Captions and translation" && o.attachOnToggle) attached = true; });
      return loc(role + ":" + name, () => 0, () => false);
    },
    getByText(text: string) { return loc("text:" + text, () => 0, () => false); },
    locator(selector: string) { return loc("css:" + selector, () => 0, () => false); },
  };
  return { page, clicks };
}
test("captions: already on with an attached zero-size Captions region returns true without clicking", async () => {
  const f = preOnPage({ regionAttached: true, settings: true, attachOnToggle: false });
  const onFail = vi.fn(async () => {});
  expect(await enableMeetCaptions(f.page, new AbortController().signal, () => true, onFail)).toBe(true);
  expect(f.clicks).toEqual([]);
  expect(onFail).not.toHaveBeenCalled();
});
test("captions: Open caption settings without a region counts as on and nothing is clicked", async () => {
  const f = preOnPage({ regionAttached: false, settings: true, attachOnToggle: false });
  expect(await enableMeetCaptions(f.page, new AbortController().signal, () => true)).toBe(true);
  expect(f.clicks).toEqual([]);
});
test("captions: off means one Captions and translation click, then an attached (not yet visible) region is accepted", async () => {
  const f = preOnPage({ regionAttached: false, settings: false, attachOnToggle: true });
  expect(await enableMeetCaptions(f.page, new AbortController().signal, () => true)).toBe(true);
  expect(f.clicks).toEqual(["button:Captions and translation"]);
  expect(f.clicks.some((c) => /gemini|translate/i.test(c))).toBe(false);
});
type Chip = { label: string; visible: boolean; attrs: Record<string, string> };
function chipPage(chips: Chip[]): { page: MeetCaptionsPage; clicks: string[]; waits: number[] } {
  const clicks: string[] = []; const waits: number[] = []; let regionOn = false;
  const one = (c: Chip | undefined, key: string): FL => {
    const l: FL = {
      count: async () => (c ? 1 : 0), isVisible: async () => c?.visible === true,
      click: async () => { clicks.push(key); regionOn = true; },
      waitFor: async () => { if (!c?.visible) throw new Error("timeout"); },
      getAttribute: async (n: string) => (n === "aria-label" ? c?.label ?? null : c?.attrs[n] ?? null),
      or: () => l, nth: () => l,
    };
    return l;
  };
  const all: FL = { count: async () => chips.length, isVisible: async () => chips.some((c) => c.visible), click: async () => { throw new Error("strict"); }, waitFor: async () => { throw new Error("strict"); }, getAttribute: async () => { throw new Error("strict"); }, or: () => all, nth: (i: number) => one(chips[i], "chip:" + (chips[i]?.label ?? "")) };
  const region: FL = { count: async () => (regionOn ? 1 : 0), isVisible: async () => regionOn, click: async () => {}, waitFor: async (o: { state: "visible"; timeout: number }) => { waits.push(o.timeout); if (!regionOn) throw new Error("timeout"); }, getAttribute: async () => null, or: () => region, nth: () => region };
  const none: FL = { count: async () => 0, isVisible: async () => false, click: async () => {}, waitFor: async () => { throw new Error("timeout"); }, getAttribute: async () => null, or: (o: FL) => o, nth: () => none };
  const page: MeetCaptionsPage = {
    getByRole(role: "button" | "checkbox" | "switch" | "region", options: { name: string | RegExp; exact?: boolean }) { return role === "button" && options.name instanceof RegExp ? all : none; },
    getByText() { return none; },
    locator(selector: string) { return selector === MEET_CAPTION_REGION_ALT_SELECTOR ? region : none; },
  };
  return { page, clicks, waits };
}
test("captions: first visible Live captions chip is used, Translate and Gemini are skipped, and the region gets 30s", async () => {
  const f = chipPage([{ label: "Translate live captions", visible: true, attrs: {} }, { label: "Live captions", visible: false, attrs: {} }, { label: "Live captions with Gemini", visible: true, attrs: {} }, { label: "Live captions", visible: true, attrs: { "aria-pressed": "false" } }]);
  expect(await enableMeetCaptions(f.page, new AbortController().signal, () => true)).toBe(true);
  expect(f.clicks).toEqual(["chip:Live captions"]);
  expect(f.waits).toEqual([30000]);
});
test("captions: a chip labelled Turn off live captions is already on and is not clicked", async () => {
  const f = chipPage([{ label: "Turn off live captions", visible: true, attrs: {} }]);
  expect(await enableMeetCaptions(f.page, new AbortController().signal, () => true)).toBe(false);
  expect(f.clicks).toEqual([]);
  expect(f.waits).toEqual([30000]);
});
test("captions: aria-checked true counts as on", async () => {
  const f = chipPage([{ label: "Live captions", visible: true, attrs: { "aria-checked": "true" } }]);
  await enableMeetCaptions(f.page, new AbortController().signal, () => true);
  expect(f.clicks).toEqual([]);
});
const NL = String.fromCharCode(10);
const TWIN = { videoPath: "/tmp/placeholder/twin.y4m", audioPath: "/tmp/placeholder/silence.wav" };
function fakeChild(o: { exitOnTerm?: boolean } = {}) {
  const exits: Array<() => void> = []; const errors: Array<() => void> = []; const data: Array<(c: unknown) => void> = []; const kills: string[] = [];
  let code: number | null = null;
  const exit = (): void => { code = 1; for (const f of exits.splice(0)) f(); };
  const child: AttachedChild = {
    get exitCode() { return code; },
    stderr: { on: (_e: "data", l: (c: unknown) => void) => { data.push(l); return undefined; } },
    once: (e: "exit" | "error", l: () => void) => { (e === "exit" ? exits : errors).push(l); return undefined; },
    kill: (sig: "SIGTERM" | "SIGKILL") => { kills.push(sig); if (o.exitOnTerm !== false) exit(); return true; },
  };
  return { child, kills, emit: (t: string) => { for (const f of data) f(t); }, exit };
}
type FP = { closed: boolean; close(): Promise<void> };
function fakeCdp(o: { grantFails?: boolean } = {}) {
  const log: string[] = []; const grants: Array<{ perms: string[]; origin: string }> = []; const pages: FP[] = [];
  const ctx = {
    pages: () => pages,
    newPage: async () => { const pg: FP = { closed: false, close: async () => { pg.closed = true; log.push("page.close"); } }; pages.push(pg); return pg; },
    clearPermissions: async () => { log.push("clear"); },
    grantPermissions: async (perms: string[], g: { origin: string }) => { if (o.grantFails) throw new Error("no"); grants.push({ perms, origin: g.origin }); },
  };
  const browser: AttachedBrowser<FP> = { contexts: () => [ctx], close: async () => { log.push("browser.close"); } };
  return { browser, log, grants, pages };
}
test("twin-image: fake-device flags keep deny-permission-prompts; default args are unchanged; only the camera is ever granted", () => {
  expect(meetChromeArgs()).toEqual(["--deny-permission-prompts"]);
  expect(meetChromeArgs("off", TWIN)).toEqual(["--deny-permission-prompts"]);
  expect(meetChromeArgs("twin-image", TWIN)).toEqual(["--deny-permission-prompts", "--use-fake-device-for-media-stream", "--use-file-for-fake-video-capture=/tmp/placeholder/twin.y4m", "--use-file-for-fake-audio-capture=/tmp/placeholder/silence.wav"]);
  expect(() => meetChromeArgs("twin-image")).toThrow();
  expect(() => meetChromeArgs("twin-image", { videoPath: "twin.y4m", audioPath: "/tmp/s.wav" })).toThrow();
  expect(() => meetChromeArgs("twin-image", { videoPath: "/tmp/twin.mp4", audioPath: "/tmp/s.wav" })).toThrow();
  expect(meetPermissionGrants("twin-image")).toEqual(["camera"]);
  expect(meetPermissionGrants("off")).toEqual([]);
  expect(meetPermissionGrants()).toEqual([]);
  for (const m of ["off", "twin-image"] as const) expect(meetPermissionGrants(m).some((g) => /micro|audio/i.test(g))).toBe(false);
});
test("attached-profile: normal Chrome child with a dedicated profile and loopback DevTools, camera-only grant, stop closes tabs and ends the child", async () => {
  const fc = fakeChild(); const cdp = fakeCdp(); const spawned: Array<{ cmd: string; args: string[] }> = []; const endpoints: string[] = [];
  const b = await launchAttachedMeetChrome<FP>({ chromePath: "/opt/chrome", profileDir: "/tmp/ss-profile", port: 0, args: meetChromeArgs("twin-image", TWIN), grants: meetPermissionGrants("twin-image"),
    spawn: (cmd, args) => { spawned.push({ cmd, args }); queueMicrotask(() => fc.emit("noise" + NL + "DevTools listening on ws://127.0.0.1:45678/devtools/browser/abc" + NL)); return fc.child; },
    connect: async (ep) => { endpoints.push(ep); return cdp.browser; } });
  expect(spawned.length).toBe(1); expect(spawned[0]?.cmd).toBe("/opt/chrome");
  const args = spawned[0]?.args ?? [];
  expect(args).toContain("--user-data-dir=/tmp/ss-profile"); expect(args).toContain("--remote-debugging-port=0"); expect(args).toContain("--remote-debugging-address=127.0.0.1"); expect(args).toContain("--deny-permission-prompts");
  expect(args.some((a) => /enable-automation/.test(a))).toBe(false);
  expect(endpoints).toEqual(["http://127.0.0.1:45678"]);
  expect(cdp.grants).toEqual([{ perms: ["camera"], origin: "https://meet.google.com" }]);
  expect(cdp.log).toEqual(["clear"]);
  const ctx = await b.newContext(); await ctx.newPage();
  await b.close(); await b.close();
  expect(cdp.pages.every((pg) => pg.closed)).toBe(true);
  expect(cdp.log).toEqual(["clear", "page.close", "browser.close"]);
  expect(fc.kills).toEqual(["SIGTERM"]);
});
test("attached-profile: default mode grants nothing; non-loopback DevTools host, early exit and grant failure fail closed", async () => {
  { const fc = fakeChild(); const cdp = fakeCdp();
    const b = await launchAttachedMeetChrome<FP>({ chromePath: "/opt/chrome", profileDir: "/tmp/p", port: 0, args: meetChromeArgs(), grants: meetPermissionGrants(), spawn: () => { queueMicrotask(() => fc.emit("DevTools listening on ws://127.0.0.1:41000/devtools/browser/x" + NL)); return fc.child; }, connect: async () => cdp.browser });
    expect(cdp.grants).toEqual([]); await b.close(); expect(fc.kills).toEqual(["SIGTERM"]); }
  { const fc = fakeChild(); let connects = 0;
    await expect(launchAttachedMeetChrome<FP>({ chromePath: "/opt/chrome", profileDir: "/tmp/p", port: 0, args: [], grants: [], readyTimeoutMs: 20, spawn: () => { queueMicrotask(() => fc.emit("DevTools listening on ws://0.0.0.0:41000/devtools/browser/x" + NL)); return fc.child; }, connect: async () => { connects++; return fakeCdp().browser; } })).rejects.toThrow(/timeout/);
    expect(connects).toBe(0); expect(fc.kills).toEqual(["SIGTERM"]); }
  { const fc = fakeChild(); let connects = 0;
    await expect(launchAttachedMeetChrome<FP>({ chromePath: "/opt/chrome", profileDir: "/tmp/p", port: 0, args: [], grants: [], spawn: () => { queueMicrotask(() => fc.exit()); return fc.child; }, connect: async () => { connects++; return fakeCdp().browser; } })).rejects.toThrow(/exited/);
    expect(connects).toBe(0); }
  { const fc = fakeChild(); const cdp = fakeCdp({ grantFails: true });
    await expect(launchAttachedMeetChrome<FP>({ chromePath: "/opt/chrome", profileDir: "/tmp/p", port: 0, args: [], grants: ["camera"], spawn: () => { queueMicrotask(() => fc.emit("DevTools listening on ws://127.0.0.1:41000/devtools/browser/x" + NL)); return fc.child; }, connect: async () => cdp.browser })).rejects.toThrow(/permission/);
    expect(cdp.log).toContain("browser.close"); expect(fc.kills).toEqual(["SIGTERM"]); }
  await expect(launchAttachedMeetChrome<FP>({ chromePath: "/opt/chrome", profileDir: "/tmp/p", port: 0, args: [], grants: ["microphone"], spawn: () => fakeChild().child, connect: async () => fakeCdp().browser })).rejects.toThrow(/camera/);
});
test("attached-profile: profile dir must be absolute and never the main Chrome profile", () => {
  expect(resolveMeetProfileDir(undefined, "/home/u")).toBe(resolve(join("/home/u", ".second-seat", "meet-worker-profile")));
  expect(resolveMeetProfileDir("/srv/meet-profile", "/home/u")).toBe(resolve("/srv/meet-profile"));
  expect(() => resolveMeetProfileDir("relative/dir", "/home/u")).toThrow();
  expect(() => resolveMeetProfileDir("/home/u", "/home/u")).toThrow();
  expect(() => resolveMeetProfileDir("/home/u/.config/google-chrome", "/home/u")).toThrow();
  expect(() => resolveMeetProfileDir("/home/u/.config/google-chrome/Default", "/home/u")).toThrow();
  expect(() => resolveMeetProfileDir("/home/u/.config", "/home/u")).toThrow();
  expect(() => resolveMeetProfileDir("/home/u/Library/Application Support/Google/Chrome/Profile 1", "/home/u")).toThrow();
  expect(defaultMeetChromePath("win32", { PROGRAMFILES: "D:/PF" })).toBe(["D:", "PF", "Google", "Chrome", "Application", "chrome.exe"].join(String.fromCharCode(92)));
  expect(defaultMeetChromePath("linux", {})).toBe("/usr/bin/google-chrome");
});
test("env: browser mode, profile and twin media are read and fail closed", () => {
  expect(meetCaptureOptsFromEnv({})).toEqual({});
  expect(meetCaptureOptsFromEnv({ SECOND_SEAT_MEET_BROWSER: "attached-profile", SECOND_SEAT_MEET_PROFILE_DIR: "/srv/meet-profile" })).toEqual({ browserMode: "attached-profile", profileDir: resolve("/srv/meet-profile") });
  expect(() => meetCaptureOptsFromEnv({ SECOND_SEAT_MEET_BROWSER: "main-profile" })).toThrow();
  expect(() => meetCaptureOptsFromEnv({ SECOND_SEAT_TWIN_VIDEO: "/tmp/placeholder/twin.y4m" })).toThrow();
  expect(meetCaptureOptsFromEnv({ SECOND_SEAT_TWIN_VIDEO: TWIN.videoPath, SECOND_SEAT_TWIN_AUDIO: TWIN.audioPath })).toEqual({ cameraMode: "twin-image", twinMedia: TWIN });
});
test("factory attached-profile twin-image: spawns via the child launcher, grants camera only, and cleans up the child", async () => {
  const fc = fakeChild(); const spawned: string[][] = []; const grants: string[][] = []; let browserClosed = 0;
  const pg = fakePage();
  const browser: AttachedBrowser<Page> = { contexts: () => [{ pages: () => [], newPage: async () => pg, clearPermissions: async () => {}, grantPermissions: async (perms: string[]) => { grants.push(perms); } }], close: async () => { browserClosed++; } };
  const admit = vi.fn(async () => false);
  const factory = createLocalMeetCaptureFactory({ expectedOwnerEmail: "owner@example.test", browserMode: "attached-profile", profileDir: "/tmp/ss-profile", cameraMode: "twin-image", twinMedia: TWIN, chromePath: "/opt/chrome", admit,
    spawnChrome: (_cmd, args) => { spawned.push(args); queueMicrotask(() => fc.emit("DevTools listening on ws://127.0.0.1:45001/devtools/browser/y" + NL)); return fc.child; },
    connectCdp: async () => browser });
  await expect(factory(scope(() => true), new AbortController().signal)).rejects.toBeInstanceOf(MeetCaptureStartError);
  expect(spawned.length).toBe(1);
  expect(spawned[0]).toContain("--use-file-for-fake-video-capture=/tmp/placeholder/twin.y4m");
  expect(grants).toEqual([["camera"]]);
  expect(admit).toHaveBeenCalledTimes(1);
  expect(browserClosed).toBe(1); expect(fc.kills).toEqual(["SIGTERM"]);
  expect(() => createLocalMeetCaptureFactory({ expectedOwnerEmail: "owner@example.test", browserMode: "attached-profile", profileDir: "rel/dir" })).toThrow();
});
test("guest join: env is read, names without AI twin are refused, captions are enabled after admission, and a captions failure keeps the worker in the call", async () => {
  expect(meetCaptureOptsFromEnv({ SECOND_SEAT_MEET_JOIN: "guest" })).toEqual({ joinMode: "guest" });
  expect(meetCaptureOptsFromEnv({ SECOND_SEAT_MEET_JOIN: "owner" })).toEqual({});
  expect(meetCaptureOptsFromEnv({ SECOND_SEAT_MEET_JOIN: "guest", SECOND_SEAT_MEET_GUEST_NAME: "Bridgett's AI twin" })).toEqual({ joinMode: "guest", guestName: "Bridgett's AI twin" });
  expect(() => meetCaptureOptsFromEnv({ SECOND_SEAT_MEET_JOIN: "visitor" })).toThrow();
  expect(() => meetCaptureOptsFromEnv({ SECOND_SEAT_MEET_JOIN: "guest", SECOND_SEAT_MEET_GUEST_NAME: "Bridgett" })).toThrow(/AI twin/);
  expect(() => meetCaptureOptsFromEnv({ SECOND_SEAT_MEET_JOIN: "guest", SECOND_SEAT_MEET_BROWSER: "attached-profile" })).toThrow();
  expect(() => meetCaptureOptsFromEnv({ SECOND_SEAT_MEET_JOIN: "guest", SECOND_SEAT_TWIN_VIDEO: TWIN.videoPath, SECOND_SEAT_TWIN_AUDIO: TWIN.audioPath })).toThrow();
  expect(() => createLocalMeetCaptureFactory({ expectedOwnerEmail: "owner@example.test", joinMode: "guest", guestName: "Bridgett" })).toThrow(/AI twin/);
  expect(() => createLocalMeetCaptureFactory({ expectedOwnerEmail: "owner@example.test", joinMode: "guest", browserMode: "attached-profile", profileDir: "/tmp/ss-profile" })).toThrow();
  const b = mkBrowser(fakePage());
  const launch = vi.fn(async () => b.browser);
  const admit = vi.fn(async () => true);
  const enableCaptions = vi.fn(async () => false);
  let t = 1000;
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const factory = createLocalMeetCaptureFactory({ expectedOwnerEmail: "owner@example.test", joinMode: "guest", launch, admit, enableCaptions, now: () => t });
    const cap = await factory(scope(() => true), new AbortController().signal);
    expect(admit).toHaveBeenCalledTimes(1);
    expect(enableCaptions).toHaveBeenCalledTimes(1);
    // Captions not on yet: the worker stays in the call (no close) and retries from sample(), throttled by the injected clock.
    expect(b.close).toHaveBeenCalledTimes(0);
    await cap.sample();
    expect(enableCaptions).toHaveBeenCalledTimes(1);
    t = 7000;
    enableCaptions.mockResolvedValue(true);
    await cap.sample();
    expect(enableCaptions).toHaveBeenCalledTimes(2);
    expect(b.close).toHaveBeenCalledTimes(0);
    await vi.waitFor(async () => { t += 10000; await cap.sample(); expect(enableCaptions).toHaveBeenCalledTimes(2); });
    expect(b.close).toHaveBeenCalledTimes(0);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("capture.admitted") || String(c[0]).includes("capture.sample"))).toBe(false);
    await cap.stop();
    expect(b.close).toHaveBeenCalledTimes(1);
  } finally {
    warn.mockRestore();
  }
});
test("captions: two Captions and translation controls (strict multi-match) click the first visible one; two attached regions count as on", async () => {
  const clicks: string[] = [];
  let regions = 0;
  const strictError = (): Error => new Error("strict mode violation");
  const many = (key: string, n: () => number, vis: (i: number) => boolean, onClick: () => void): FL => {
    const at = (i: number): FL => {
      const one: FL = {
        count: async () => (i < n() ? 1 : 0),
        isVisible: async () => i < n() && vis(i),
        click: async () => { clicks.push(key + "#" + String(i)); onClick(); },
        waitFor: async () => { if (i >= n()) throw new Error("timeout"); },
        getAttribute: async () => null,
        or: () => one,
        nth: () => one,
      };
      return one;
    };
    const all: FL = {
      count: async () => n(),
      isVisible: async () => { if (n() > 1) throw strictError(); return n() === 1 && vis(0); },
      click: async () => { if (n() > 1) throw strictError(); clicks.push(key); onClick(); },
      waitFor: async () => { if (n() > 1) throw strictError(); if (n() === 0) throw new Error("timeout"); },
      getAttribute: async () => { if (n() > 1) throw strictError(); return null; },
      or: () => all,
      nth: (i: number) => at(i),
    };
    return all;
  };
  const none = many("none", () => 0, () => false, () => {});
  const toggle = many("toggle", () => 2, (i) => i === 1, () => { regions = 2; });
  const region = many("region", () => regions, () => false, () => {});
  const page: MeetCaptionsPage = {
    getByRole(role, options) {
      if (role === "region") return region;
      if (role === "button" && options.name === "Captions and translation") return toggle;
      return none;
    },
    getByText() { return none; },
    locator() { return none; },
  };
  const onFail = vi.fn(async () => {});
  expect(await enableMeetCaptions(page, new AbortController().signal, () => true, onFail)).toBe(true);
  expect(clicks).toEqual(["toggle#1"]);
  expect(onFail).not.toHaveBeenCalled();
});
// MSF31: live 4:08 PM CT run: "Captions and translation" opens a bottom tray with a "Live captions" chip and "Translate speech".
function trayPage(o: { chipPressed: boolean; preOn: boolean }): { page: MeetCaptionsPage; clicks: string[]; waits: number[] } {
  const clicks: string[] = []; const waits: number[] = []; let trayOpen = false; let chipOn = o.chipPressed; let regionOn = o.preOn;
  const loc = (key: string, visible: () => boolean, onClick: () => void, attrs: () => Record<string, string>): FL => {
    const l: FL = {
      count: async () => (visible() ? 1 : 0), isVisible: async () => visible(),
      click: async () => { clicks.push(key); onClick(); },
      waitFor: async (w: { state: "visible"; timeout: number }) => { waits.push(w.timeout); if (!visible()) throw new Error("timeout"); },
      getAttribute: async (n: string) => (n === "aria-label" ? key : attrs()[n] ?? null),
      or: () => l, nth: () => l,
    };
    return l;
  };
  const none = loc("none", () => false, () => {}, () => ({}));
  const translate = loc("Translate speech", () => trayOpen, () => {}, () => ({ "aria-pressed": "false" }));
  const live = loc("Live captions", () => trayOpen, () => { chipOn = true; regionOn = true; }, () => ({ "aria-pressed": chipOn ? "true" : "false" }));
  const chips: FL = { count: async () => (trayOpen ? 2 : 0), isVisible: async () => trayOpen, click: async () => { throw new Error("strict"); }, waitFor: async () => { throw new Error("strict"); }, getAttribute: async () => { throw new Error("strict"); }, or: () => chips, nth: (i: number) => (!trayOpen ? none : i === 0 ? translate : i === 1 ? live : none) };
  const toggle = loc("Captions and translation", () => true, () => { trayOpen = true; }, () => ({}));
  const region = loc("Captions", () => regionOn || (trayOpen && chipOn), () => {}, () => ({}));
  const page: MeetCaptionsPage = {
    getByRole(role: "button" | "checkbox" | "switch" | "region", options: { name: string | RegExp; exact?: boolean }) {
      if (role === "region") return options.name === "Captions" ? region : none;
      if (options.name instanceof RegExp) return chips;
      return options.name === "Captions and translation" && role === "button" ? toggle : none;
    },
    getByText() { return none; },
    locator(selector: string) { return selector === MEET_CAPTION_REGION_SELECTOR || selector === MEET_CAPTION_REGION_ALT_SELECTOR ? region : none; },
  };
  return { page, clicks, waits };
}
test("MSF31 captions tray: the toggle opens the tray, the Live captions chip is off and clicked once, the region attaches; Translate is never clicked", async () => {
  const f = trayPage({ chipPressed: false, preOn: false });
  expect(await enableMeetCaptions(f.page, new AbortController().signal, () => true, async () => {}, 50)).toBe(true);
  expect(f.clicks).toEqual(["Captions and translation", "Live captions"]);
  expect(f.clicks.some((c) => /translate speech|gemini/i.test(c))).toBe(false);
  expect(f.waits).toContain(50);
});
test("MSF31 captions tray: a Live captions chip that is already pressed is not clicked", async () => {
  const f = trayPage({ chipPressed: true, preOn: false });
  expect(await enableMeetCaptions(f.page, new AbortController().signal, () => true, async () => {}, 50)).toBe(true);
  expect(f.clicks).toEqual(["Captions and translation"]);
});
test("MSF31 captions tray: captions already on means no clicks at all", async () => {
  const f = trayPage({ chipPressed: false, preOn: true });
  expect(await enableMeetCaptions(f.page, new AbortController().signal, () => true, async () => {}, 50)).toBe(true);
  expect(f.clicks).toEqual([]);
});
test("MSF31 diagnostic: caption switches and checkboxes log their aria state, unnamed ones use nearby text, emails are redacted", async () => {
  const el = (attrs: Record<string, string>, text: string) => ({ getAttribute: async (n: string) => attrs[n] ?? null, innerText: async () => text });
  const page = { locator: (sel: string) => ({ all: async () => (sel.includes("switch") ? [el({ "aria-label": "Live captions", "aria-checked": "false" }, ""), el({}, "Live captions for owner@example.test")] : sel.includes("button") ? [el({ "aria-label": "Captions and translation", "aria-pressed": "true" }, "")] : []) }) };
  const out = await collectMeetUiDiagnostic(page);
  expect(out).toContain("switch: Live captions checked=false");
  expect(out).toContain("button: Captions and translation pressed=true");
  expect(out).toContain("switch: Live captions for [email]");
  expect(out.includes("@")).toBe(false);
});
