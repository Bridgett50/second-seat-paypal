import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { existsSync } from "node:fs";
import type { Server } from "node:http";
import { chromium, type APIRequestContext, type APIResponse, type Browser, type BrowserContext, type Page, type Route } from "@playwright/test";
import { createWebServer } from "../src/server.js";
import { createMeetingRoomService, type CandidateReasonerInput } from "../src/meetingRoom.js";

const TEST_ENV: Readonly<Record<string,string|undefined>>={SECOND_SEAT_TEST_MODE:"1"};
const CHROME_PATH=process.env.PLAYWRIGHT_CHROME_PATH||"/usr/bin/google-chrome";
const CHROME_LAUNCH: { executablePath?: string } = process.env.PLAYWRIGHT_CHROME_PATH||existsSync(CHROME_PATH) ? {executablePath:CHROME_PATH} : {};
const API="/api/meeting-room";
const T0=new Date("2026-01-01T00:00:00.000Z").getTime();
const T1=new Date("2026-01-01T00:01:00.000Z").getTime();
const POLL_INTERVAL=1500;

type Deferred<T>={promise:Promise<T>;resolve:(v:T)=>void;reject:(e:unknown)=>void};
function deferred<T>():Deferred<T>{let resolve!:(v:T)=>void;let reject!:(e:unknown)=>void;const promise=new Promise<T>((res,rej)=>{resolve=res;reject=rej;});return{promise,resolve,reject};}
type Fake={reasoner:(input:CandidateReasonerInput)=>Promise<unknown>;calls:CandidateReasonerInput[];pending:Deferred<unknown>[]};
function createFake():Fake{
  const calls:CandidateReasonerInput[]=[];const pending:Deferred<unknown>[]=[];
  const reasoner=(input:CandidateReasonerInput):Promise<unknown>=>{calls.push(input);const d=deferred<unknown>();pending.push(d);return d.promise;};
  return {reasoner,calls,pending};
}
function ingest(svc:unknown,key:string,roomId:string,p:{meetingId:string,utteranceId:string,sequence:number,revision:number,speaker:string,text:string}){
  return (svc as unknown as {ingestConversationAs:(k:string,r:string,v:unknown)=>unknown}).ingestConversationAs(key,roomId,{version:1,meetingId:p.meetingId,utteranceId:p.utteranceId,sequence:p.sequence,revision:p.revision,speaker:p.speaker,text:p.text});
}
let base="";
let browser: Browser;
beforeAll(async()=>{browser=await chromium.launch({...CHROME_LAUNCH,headless:true});},60_000);
afterAll(async()=>{await browser?.close();});

function isApi(url:string){return new URL(url).pathname===API;}
async function post(req:APIRequestContext,body:Record<string,unknown>){
  const res=await req.post(`${base}${API}`,{data:body,headers:{"content-type":"application/json"}});
  const text=await res.text();let json:Record<string,unknown>|null=null;try{json=JSON.parse(text) as Record<string,unknown>;}catch{json=null;}return{status:res.status(),json};
}
async function installClock(page:Page){
  await page.clock.install({time:T0});
  await page.addInitScript("window.__stateDispatched=0;window.__stateOutstanding=0;const oFetch=window.fetch;window.fetch=function(u,i){try{const b=(i&&i.body)||\"\";if(typeof b===\"string\"&&b.includes('\"action\":\"state\"')){window.__stateDispatched+=1;window.__stateOutstanding+=1;const p=oFetch.apply(this,arguments);p.finally(()=>{window.__stateOutstanding-=1;});return p;}}catch{}return oFetch.apply(this,arguments);};");
  await page.goto(`${base}/meeting-room`);
  await page.clock.pauseAt(T1);
}
async function flush(page:Page){
  for(let i=0;i<3;i++) await page.evaluate("new Promise(r=>{const c=new MessageChannel();c.port1.onmessage=()=>r(0);c.port2.postMessage(0);})");
}
async function stateDispatched(page:Page):Promise<number>{ const v=await page.evaluate<number>("window.__stateDispatched"); return v; }
async function stateOutstanding(page:Page):Promise<number>{ const v=await page.evaluate<number>("window.__stateOutstanding"); return v; }
async function installClockBeforeGoto(page:Page){
  await page.clock.install({time:T0});
  await page.clock.pauseAt(T0+1000);
  await page.addInitScript("window.__stateDispatched=0;window.__stateOutstanding=0;const oFetch=window.fetch;window.fetch=function(u,i){try{const b=(i&&i.body)||\"\";if(typeof b===\"string\"&&b.includes('\"action\":\"state\"')){window.__stateDispatched+=1;window.__stateOutstanding+=1;const p=oFetch.apply(this,arguments);p.finally(()=>{window.__stateOutstanding-=1;});return p;}}catch{}return oFetch.apply(this,arguments);};");
  await page.goto(`${base}/meeting-room`);
}
async function clickAndWait(page:Page,selector:string){
  const pending=page.waitForResponse(r=>isApi(r.url())&&r.request().method()==="POST");
  await page.locator(selector).first().click();
  const res=await pending; await res.finished(); await flush(page);
  return res;
}
async function advanceAndWaitPoll(page:Page,ms:number){
  const pending=page.waitForResponse(r=>isApi(r.url())&&r.request().method()==="POST"&&(r.request().postData()??"").includes('"action":"state"'));
  await page.clock.runFor(ms);
  const res=await pending; await res.finished(); await flush(page);
  return res;
}
async function installLoopbackGuard(ctx:BrowserContext){
  const violations:string[]=[];
  await ctx.route("**/*",async route=>{
    const u=route.request().url();
    let host="";
    try{host=new URL(u).hostname;}catch{host="";}
    if(host!=="127.0.0.1"&&host!=="localhost"&&host!==""){ await route.abort(); violations.push(u); return;}
    await route.continue();
  });
  return violations;
}
function viewOf(r:{json:Record<string,unknown>|null}){return ((r.json as unknown as {snapshot:{view:unknown}}).snapshot.view) as {selectedMeetingId:string,twinStatus:string};}
function candidateOf(r:{json:Record<string,unknown>|null}){return (r.json as unknown as {snapshot:{candidate:unknown}}).snapshot.candidate as {subject:string|null,body:string|null,status:string}|null;}
function holdFirstStateDeferred():Deferred<{route:Route;resp:APIResponse}>{
  return deferred<{route:Route;resp:APIResponse}>();
}
function trackStateFinished(page:Page){
  let n=0;
  const waits:{at:number;d:Deferred<void>}[]=[];
  page.on("requestfinished",r=>{
    if(isApi(r.url())&&(r.postData()??"").includes('"action":"state"')){
      n+=1;
      for(let i=waits.length-1;i>=0;i--){
        const w=waits[i];
        if(w&&n>=w.at){ waits.splice(i,1); w.d.resolve(); }
      }
    }
  });
  return {count:()=>n,until:(at:number):Promise<void>=>{
    if(n>=at) return Promise.resolve();
    const d=deferred<void>(); waits.push({at,d}); return d.promise;
  }};
}

describe("meeting-room candidate browser",()=>{
  it("none -> resolved shows escaped subject/body without click and single reasoner call",async()=>{
    const fake=createFake();
    const svc=createMeetingRoomService({env:TEST_ENV,conversationInput:true,sessionPolicy:true,candidateReasoner:fake.reasoner});
    const server=createWebServer({meetingRoom:svc} as unknown as never);
    await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
    base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const ctx=await browser.newContext(); const violations=await installLoopbackGuard(ctx); const page=await ctx.newPage();
    try{
      await page.clock.install({time:T0});
      await page.goto(`${base}/meeting-room`);
      await page.clock.pauseAt(T1);
      const roomId=await page.locator("#mr-root").getAttribute("data-room-id");
      expect(roomId).toBeTruthy();
      const st=await post(ctx.request,{roomId:roomId as string,action:"state"});
      expect(st.status).toBe(200);
      const meetingId=viewOf(st).selectedMeetingId;
      expect(await page.locator("#mr-candidate-panel").textContent()).toContain("No candidate yet");
      expect((await page.locator("#mr-candidate-panel").textContent())??"").toContain("provisional");
      expect((await page.locator("#mr-candidate-panel").textContent())??"").toContain("private");
      expect(await page.locator('[aria-live="polite"]').count()).toBe(1);
      let pollCount=0;
      await page.route(`**${API}`,async route=>{ const d=route.request().postData()??""; if(d.includes('"action":"state"')) pollCount+=1; await route.continue();});
      await page.clock.runFor(500);
      expect(pollCount).toBe(0);
      const storeKey=(await ctx.cookies()).find(c=>c.name==="mr_store")?.value as string;
      expect(storeKey).toBeTruthy();
      const subj='Sub <j>&"\' test'; const body='Body & <b>hi</b> "quotes"';
      ingest(svc,storeKey,roomId as string,{meetingId,utteranceId:"u1",sequence:1,revision:1,speaker:"a",text:"hello"});
      expect(fake.calls.length).toBe(1);
      const ctxRev=1;
      fake.pending[0]!.resolve({status:"provisional",meetingId,contextRevision:ctxRev,subject:subj,body,sourceRefs:[{utteranceId:"u1",revision:1}],note:"ok"});
      const pollW=page.waitForResponse(r=>isApi(r.url())&&(r.request().postData()??"").includes('"action":"state"'));
      await page.clock.runFor(2000);
      const pollRes=await pollW; await pollRes.finished(); await flush(page);
      const panel=page.locator("#mr-candidate-panel");
      const text=await panel.textContent();
      expect(text).toContain(subj);
      expect(text).toContain(body);
      expect(text).toContain("u1");
      expect(text).toContain(String(ctxRev));
      expect(text).toContain("not policy-checked");
      expect(await panel.locator("b").count()).toBe(0);
      expect(await panel.locator("button").count()).toBe(1);
      expect(await panel.locator('[data-mr-action="adopt-candidate"]').count()).toBe(1);
      expect(await panel.locator('[data-mr-action="adopt-candidate"]').textContent()).toBe("Use this email");
      if (!roomId) throw new Error("missing roomId");
      const res = await svc.actAs(storeKey, {roomId, action: "state"}, {host: new URL(base).host});
      if (!res || !res.body || !res.body.snapshot) throw new Error("missing snapshot");
      const snapshot = res.body.snapshot;
      const preview = snapshot.candidatePreview;
      if (!preview) throw new Error("missing candidatePreview");
      const candidate = snapshot.candidate;
      if (!candidate) throw new Error("missing candidate");
      expect(preview.status).toBe("released");
      expect(candidate.approved).toBe(false);
      expect(candidate.policyChecked).toBe(false);
      expect(svc.sentBodies().length).toBe(0);
      expect(await panel.locator('[data-mr-action="adopt-candidate"]').getAttribute("data-mr-candidate-id")).toBe(preview.candidateId);
      expect(await panel.locator('[data-mr-action="adopt-candidate"]').getAttribute("data-mr-context-revision")).toBe(String(candidate.contextRevision));
      expect(await panel.locator('[data-mr-action="adopt-candidate"]').getAttribute("data-mr-policy-generation")).toBe(String(preview.generation));
      expect(await panel.locator("input").count()).toBe(0);
      expect(await panel.locator("textarea").count()).toBe(0);
      expect(await panel.locator("select").count()).toBe(0);
      expect(fake.calls.length).toBe(1);
      expect(pollCount).toBe(1);
      expect(violations.length).toBe(0);
    } finally { await ctx.close(); await new Promise<void>(r=>server.close(()=>r())); }
  },60_000);

  it("stale poll does not overwrite and action response not suppressed",async()=>{
    const fake=createFake();
    const svc=createMeetingRoomService({env:TEST_ENV,conversationInput:true,sessionPolicy:true,candidateReasoner:fake.reasoner});
    const server=createWebServer({meetingRoom:svc} as unknown as never);
    await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
    base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const ctx=await browser.newContext(); const violations=await installLoopbackGuard(ctx); const page=await ctx.newPage();
    try{
      await installClock(page);
      const roomId=await page.locator("#mr-root").getAttribute("data-room-id");
      const st=await post(ctx.request,{roomId:roomId as string,action:"state"});
      const meetingId=viewOf(st).selectedMeetingId;
      await page.waitForSelector("#mr-candidate-panel");
      const storeKey=(await ctx.cookies()).find(c=>c.name==="mr_store")?.value as string;
      ingest(svc,storeKey,roomId as string,{meetingId,utteranceId:"u2",sequence:1,revision:1,speaker:"a",text:"hi"});
      fake.pending[0]!.resolve({status:"provisional",meetingId,contextRevision:5,subject:"Held Subject",body:"Held Body",sourceRefs:[{utteranceId:"u2",revision:1}],note:"held"});
      const cap=deferred<{route:Route;resp:APIResponse}>();
      await page.route(`${base}${API}`,async route=>{
        const d=route.request().postData()??"";
        if(d.includes('"action":"state"')){ const resp=await route.fetch(); cap.resolve({route,resp}); return; }
        await route.continue();
      });
      await page.clock.runFor(2000);
      await cap.promise;
      // action while held
      await page.locator("#guidance-input").fill("new guidance");
      const actionPending=page.waitForResponse(r=>isApi(r.url())&&r.request().method()==="POST"&&(r.request().postData()??"").includes('"action":"guide"'));
      await page.locator("#guidance-send").click();
      const actionRes=await actionPending; await actionRes.finished(); await flush(page);
      expect(actionRes.ok()).toBeTruthy();
      // release stale captured response
      const held=await cap.promise;
      await held.route.fulfill({response:held.resp});
      await flush(page);
      // allow any microtasks to settle
      await page.clock.runFor(100);
      await flush(page);
      const text=await page.locator("#mr-candidate-panel").textContent();
      expect(text).not.toContain("Held Subject");
      expect(await page.locator("#guidance-input").inputValue()).toBe("");
      expect(violations.length).toBe(0);
    } finally { await ctx.close(); await new Promise<void>(r=>server.close(()=>r())); }
  },60_000);

  it("dirty editor preserved across candidate poll",async()=>{
    const fake=createFake();
    const svc=createMeetingRoomService({env:TEST_ENV,conversationInput:true,sessionPolicy:true,candidateReasoner:fake.reasoner});
    const server=createWebServer({meetingRoom:svc} as unknown as never);
    await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
    base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const ctx=await browser.newContext(); const violations=await installLoopbackGuard(ctx); const page=await ctx.newPage();
    try{
      await installClock(page);
      const roomId=await page.locator("#mr-root").getAttribute("data-room-id");
      const st=await post(ctx.request,{roomId:roomId as string,action:"state"});
      const meetingId=viewOf(st).selectedMeetingId;
      await page.waitForSelector("#mr-candidate-panel");
      const storeKey=(await ctx.cookies()).find(c=>c.name==="mr_store")?.value as string;
      ingest(svc,storeKey,roomId as string,{meetingId,utteranceId:"u3",sequence:1,revision:1,speaker:"a",text:"hi"});
      fake.pending[0]!.resolve({status:"provisional",meetingId,contextRevision:2,subject:"S1",body:"B1",sourceRefs:[{utteranceId:"u3",revision:1}],note:"n"});
      // establish approval and enabled Send
      const approveWait=page.waitForResponse(r=>isApi(r.url())&&(r.request().postData()??"").includes('"action":"approve"'));
      await page.locator("#approve").click();
      const apr=await approveWait; await apr.finished(); await flush(page);
      expect(await page.locator("#mr-approval-state").textContent()).toContain("Approved: yes");
      expect(await page.locator("#mr-approval-state").textContent()).toContain("Send: unsent");
      expect(await page.locator("#approve").isDisabled()).toBeFalsy();
      expect(await page.locator("#send").isDisabled()).toBeFalsy();
      // wait for S1 poll to render
      const w1=page.waitForResponse(r=>isApi(r.url())&&(r.request().postData()??"").includes('"action":"state"'));
      await page.clock.runFor(2000);
      const r1=await w1; await r1.finished(); await flush(page);
      expect((await page.locator("#mr-candidate-panel").textContent())??"").toContain("S1");
      // dirty edit immediately disables outgoing
      await page.locator("#package-editor").fill("dirty text here");
      expect(await page.locator("#approve").isDisabled()).toBeTruthy();
      expect(await page.locator("#send").isDisabled()).toBeTruthy();
      await page.evaluate("(()=>{const el=document.getElementById(\"package-editor\"); el.selectionStart=2; el.selectionEnd=5;})()");
      // second candidate should not clobber editor
      ingest(svc,storeKey,roomId as string,{meetingId,utteranceId:"u4",sequence:2,revision:1,speaker:"a",text:"hi2"});
      expect(fake.pending.length).toBe(2);
      fake.pending[1]!.resolve({status:"provisional",meetingId,contextRevision:3,subject:"S2",body:"B2",sourceRefs:[{utteranceId:"u4",revision:1}],note:"n2"});
      const w2=page.waitForResponse(r=>isApi(r.url())&&(r.request().postData()??"").includes('"action":"state"'));
      await page.clock.runFor(2000);
      const r2=await w2; await r2.finished(); await flush(page);
      expect((await page.locator("#mr-candidate-panel").textContent())??"").toContain("S2");
      expect(await page.locator("#package-editor").inputValue()).toBe("dirty text here");
      expect(await page.evaluate("document.activeElement?.id")).toBe("package-editor");
      const sel=await page.evaluate("(()=>{const el=document.getElementById(\"package-editor\"); return [el.selectionStart, el.selectionEnd];})()") as number[];
      expect(sel).toEqual([2,5]);
      expect(await page.locator("#approve").isDisabled()).toBeTruthy();
      expect(await page.locator("#send").isDisabled()).toBeTruthy();
      // fill again disables and polling never re-enables
      await page.locator("#package-editor").fill("more dirty");
      expect(await page.locator("#approve").isDisabled()).toBeTruthy();
      const w3=page.waitForResponse(r=>isApi(r.url())&&(r.request().postData()??"").includes('"action":"state"'));
      await page.clock.runFor(2000); const r3=await w3; await r3.finished(); await flush(page);
      expect(await page.locator("#approve").isDisabled()).toBeTruthy();
      expect(violations.length).toBe(0);
    } finally { await ctx.close(); await new Promise<void>(r=>server.close(()=>r())); }
  },60_000);

  it("at most one poll in flight per interval and no poll when legacy/hidden/stopped",async()=>{
    const legacySvc=createMeetingRoomService({env:TEST_ENV});
    const legacyServer=createWebServer({meetingRoom:legacySvc} as unknown as never);
    await new Promise<void>(r=>legacyServer.listen(0,"127.0.0.1",r));
    const legacyBase=`http://127.0.0.1:${(legacyServer.address() as AddressInfo).port}`;
    const ctx1=await browser.newContext(); const v1=await installLoopbackGuard(ctx1); const page1=await ctx1.newPage();
    let legacyPolls=0;
    try{
      base=legacyBase;
      await page1.clock.install({time:T0});
      await page1.clock.pauseAt(T0+1000);
      await page1.addInitScript("window.__stateDispatched=0;window.__stateOutstanding=0;const oFetch=window.fetch;window.fetch=function(u,i){try{const b=(i&&i.body)||\"\";if(typeof b===\"string\"&&b.includes('\"action\":\"state\"')){window.__stateDispatched+=1;window.__stateOutstanding+=1;const p=oFetch.apply(this,arguments);p.finally(()=>{window.__stateOutstanding-=1;});return p;}}catch{}return oFetch.apply(this,arguments);};");
      await page1.goto(`${legacyBase}/meeting-room`);
      await page1.route(`${legacyBase}${API}`,async route=>{const d=route.request().postData()??""; if(d.includes('"action":"state"')) legacyPolls+=1; await route.continue();});
      await page1.clock.runFor(6000);
      await flush(page1);
      expect(legacyPolls).toBe(0);
      expect(await page1.evaluate<number>("window.__stateDispatched")).toBe(0);
      expect(await page1.locator("#mr-candidate-panel").count()).toBe(0);
      expect(v1.length).toBe(0);
    } finally { await ctx1.close(); await new Promise<void>(r=>legacyServer.close(()=>r())); }
    const fake=createFake();
    const svc=createMeetingRoomService({env:TEST_ENV,conversationInput:true,sessionPolicy:true,candidateReasoner:fake.reasoner});
    const server=createWebServer({meetingRoom:svc} as unknown as never);
    await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
    base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const ctx=await browser.newContext(); const violations=await installLoopbackGuard(ctx); const page=await ctx.newPage();
    try{
      await installClockBeforeGoto(page);
      await page.waitForSelector("#mr-candidate-panel");
      // repeated UI renders must not multiply timers
      let held: {route:Route;resp:APIResponse}|undefined;
      let captured=false;
      const cap2=deferred<{route:Route;resp:APIResponse}>();
      await page.route(`${base}${API}`,async route=>{
        const d=route.request().postData()??"";
        if(d.includes('"action":"state"')){ if(!captured){ captured=true; const resp=await route.fetch(); held={route,resp}; cap2.resolve({route,resp}); return; } await route.continue(); return; }
        await route.continue();
      });
      // trigger re-renders via real clicks
      for(let i=0;i<3;i++){
        const pw=page.waitForResponse(r=>isApi(r.url())&&(r.request().postData()??"").includes('"action":"guide"'));
        await page.locator("#guidance-input").fill(`g${i}`);
        await page.locator("#guidance-send").click();
        const rr=await pw; await rr.finished(); await flush(page);
      }
      await page.clock.runFor(2000);
      await cap2.promise;
      await flush(page);
      expect(await page.evaluate<number>("window.__stateDispatched")).toBe(1);
      expect(await page.evaluate<number>("window.__stateOutstanding")).toBe(1);
      for(let i=0;i<3;i++){ await page.clock.runFor(POLL_INTERVAL); await flush(page); expect(await page.evaluate<number>("window.__stateDispatched")).toBe(1); }
      const rel2=held as {route:Route;resp:APIResponse};
      const nxtWait=page.waitForResponse(r=>isApi(r.url())&&(r.request().postData()??"").includes('"action":"state"'));
      await rel2.route.fulfill({response:rel2.resp}); await nxtWait.then(r=>r.finished()); await flush(page);
      await page.clock.runFor(2000); await flush(page);
      expect(await page.evaluate<number>("window.__stateDispatched")).toBe(2);
      await page.evaluate("Object.defineProperty(document,\"visibilityState\",{get:()=>\"hidden\",configurable:true}); document.dispatchEvent(new Event(\"visibilitychange\"))");
      const beforeHidden=await page.evaluate<number>("window.__stateDispatched");
      await page.clock.runFor(6000); await flush(page);
      expect(await page.evaluate<number>("window.__stateDispatched")).toBe(beforeHidden);
      await page.evaluate("Object.defineProperty(document,\"visibilityState\",{get:()=>\"visible\",configurable:true}); document.dispatchEvent(new Event(\"visibilitychange\"))");
      await page.clock.runFor(2000); await flush(page);
      expect(await page.evaluate<number>("window.__stateDispatched")).toBeGreaterThan(beforeHidden);
      const beforeTakeover=await page.evaluate<number>("window.__stateDispatched");
      const tkW=page.waitForResponse(r=>isApi(r.url())&&(r.request().postData()??"").includes('"action":"takeover"'));
      await page.locator("#takeover").click();
      const tk=await tkW; await tk.finished(); await flush(page);
      await page.clock.runFor(6000); await flush(page);
      expect(await page.evaluate("window.__stateDispatched")).toBe(beforeTakeover);
      expect(violations.length).toBe(0);
    } finally { await ctx.close(); await new Promise<void>(r=>server.close(()=>r())); }
  },60_000);

  it("regression(a) draft-input discard keeps polling live",async()=>{
    const fake=createFake();
    const svc=createMeetingRoomService({env:TEST_ENV,conversationInput:true,sessionPolicy:true,candidateReasoner:fake.reasoner});
    const server=createWebServer({meetingRoom:svc});
    await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
    base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const ctx=await browser.newContext(); const violations=await installLoopbackGuard(ctx); const page=await ctx.newPage();
    try{
      await installClockBeforeGoto(page);
      expect(await stateDispatched(page)).toBe(0);
      const roomId=await page.locator("#mr-root").getAttribute("data-room-id") ?? "";
      const st=await post(ctx.request,{roomId,action:"state"});
      const meetingId=viewOf(st).selectedMeetingId;
      const storeKey=ctx.cookies().then(c=>c.find(x=>x.name==="mr_store")?.value ?? "");
      const key=await storeKey;
      ingest(svc,key,roomId,{meetingId,utteranceId:"u10",sequence:1,revision:1,speaker:"a",text:"hi"});
      const p0=fake.pending[0]; expect(p0).toBeDefined(); if(p0===undefined) throw new Error("no pending reasoner call"); p0.resolve({status:"provisional",meetingId,contextRevision:1,subject:"OldSub",body:"OldBody",sourceRefs:[{utteranceId:"u10",revision:1}],note:"n"});
      let captured=false; const cap=holdFirstStateDeferred();
      await page.route(`${base}${API}`,async route=>{
        const d=route.request().postData() ?? "";
        if(d.includes('"action":"state"') && captured===false){ captured=true; const resp=await route.fetch(); cap.resolve({route,resp}); return; }
        await route.continue();
      });
      await page.clock.runFor(POLL_INTERVAL+500); await cap.promise;
      expect(await stateDispatched(page)).toBe(1);
      await page.locator("#package-editor").fill("user draft");
      await flush(page);
      const pend=page.waitForResponse(r=>isApi(r.url())&&(r.request().postData() ?? "").includes('"action":"state"'));
      const held=await cap.promise;
      await held.route.fulfill({response:held.resp}); const got=await pend; await got.finished(); await flush(page);
      expect(await stateOutstanding(page)).toBe(0); expect(await stateDispatched(page)).toBe(1);
      expect((await page.locator("#mr-candidate-panel").textContent()) ?? "").not.toContain("OldSub");
      expect(await page.locator("#package-editor").inputValue()).toBe("user draft");
      expect(await page.locator("#approve").isDisabled()).toBeTruthy();
      expect(await page.locator("#send").isDisabled()).toBeTruthy();
      expect(await page.locator("#evidence-export").isDisabled()).toBeTruthy();
      const nextPend=page.waitForResponse(r=>isApi(r.url())&&(r.request().postData() ?? "").includes('"action":"state"')); nextPend.catch(()=>undefined);
      await page.clock.runFor(POLL_INTERVAL); await flush(page);
      expect(await stateDispatched(page)).toBe(2); expect(await stateOutstanding(page) <= 1).toBeTruthy();
      const np=await nextPend; await np.finished(); await flush(page);
      expect(np.ok()).toBeTruthy();
      expect(await page.locator("#package-editor").inputValue()).toBe("user draft");
      expect(await page.locator("#approve").isDisabled()).toBeTruthy();
      expect(await page.locator("#send").isDisabled()).toBeTruthy();
      expect(await page.locator("#evidence-export").isDisabled()).toBeTruthy();
      expect(violations.length).toBe(0);
    } finally { await ctx.close(); await new Promise<void>(r=>server.close(()=>r())); }
  },60_000);
  it("regression(a) newer-guidance discard keeps polling live",async()=>{
    const fake=createFake();
    const svc=createMeetingRoomService({env:TEST_ENV,conversationInput:true,sessionPolicy:true,candidateReasoner:fake.reasoner});
    const server=createWebServer({meetingRoom:svc});
    await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
    base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const ctx=await browser.newContext(); const violations=await installLoopbackGuard(ctx); const page=await ctx.newPage();
    try{
      await installClockBeforeGoto(page);
      expect(await stateDispatched(page)).toBe(0);
      const roomId=await page.locator("#mr-root").getAttribute("data-room-id") ?? "";
      const st=await post(ctx.request,{roomId,action:"state"});
      const meetingId=viewOf(st).selectedMeetingId;
      const key=await ctx.cookies().then(c=>c.find(x=>x.name==="mr_store")?.value ?? "");
      ingest(svc,key,roomId,{meetingId,utteranceId:"u10",sequence:1,revision:1,speaker:"a",text:"hi"});
      const p0=fake.pending[0]; expect(p0).toBeDefined(); if(p0===undefined) throw new Error("no pending reasoner call"); p0.resolve({status:"provisional",meetingId,contextRevision:1,subject:"OldSub",body:"OldBody",sourceRefs:[{utteranceId:"u10",revision:1}],note:"n"});
      let captured=false; const cap=holdFirstStateDeferred();
      await page.route(`${base}${API}`,async route=>{
        const d=route.request().postData() ?? "";
        if(d.includes('"action":"state"') && captured===false){ captured=true; const resp=await route.fetch(); cap.resolve({route,resp}); return; }
        await route.continue();
      });
      await page.clock.runFor(POLL_INTERVAL+500); await cap.promise;
      expect(await stateDispatched(page)).toBe(1);
      await page.locator("#guidance-input").fill("guidance2");
      const actW=page.waitForResponse(r=>isApi(r.url())&&(r.request().postData() ?? "").includes('"action":"guide"'));
      await page.locator("#guidance-send").click(); const act=await actW; await act.finished(); await flush(page);
      expect((await page.locator("#mr-candidate-panel").textContent()) ?? "").toContain("Status: none");
      expect((await page.locator("#mr-candidate-panel").textContent()) ?? "").not.toContain("OldSub");
      expect(await page.locator("#guidance-input").inputValue()).toBe("");
      const pend=page.waitForResponse(r=>isApi(r.url())&&(r.request().postData() ?? "").includes('"action":"state"'));
      const held=await cap.promise;
      await held.route.fulfill({response:held.resp}); const got=await pend; await got.finished(); await flush(page);
      expect(await stateOutstanding(page)).toBe(0); expect(await stateDispatched(page)).toBe(1);
      expect((await page.locator("#mr-candidate-panel").textContent()) ?? "").toContain("Status: none");
      expect((await page.locator("#mr-candidate-panel").textContent()) ?? "").not.toContain("OldSub");
      expect(await page.locator("#guidance-input").inputValue()).toBe("");
      const nextPend=page.waitForResponse(r=>isApi(r.url())&&(r.request().postData() ?? "").includes('"action":"state"')); nextPend.catch(()=>undefined);
      await page.clock.runFor(POLL_INTERVAL); await flush(page);
      expect(await stateDispatched(page)).toBe(2); expect(await stateOutstanding(page) <= 1).toBeTruthy();
      const np=await nextPend; await np.finished(); await flush(page);
      expect(np.ok()).toBeTruthy();
      expect((await page.locator("#mr-candidate-panel").textContent()) ?? "").toContain("Status: none");
      expect(await page.locator("#guidance-input").inputValue()).toBe("");
      expect(violations.length).toBe(0);
    } finally { await ctx.close(); await new Promise<void>(r=>server.close(()=>r())); }
  },60_000);

  it("regression(b) hidden-only stop discards held poll without repaint or restart",async()=>{
    const fake=createFake();
    const svc=createMeetingRoomService({env:TEST_ENV,conversationInput:true,sessionPolicy:true,candidateReasoner:fake.reasoner});
    const server=createWebServer({meetingRoom:svc});
    await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
    base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const ctx=await browser.newContext(); const violations=await installLoopbackGuard(ctx); const page=await ctx.newPage();
    try{
      await installClockBeforeGoto(page);
      expect(await stateDispatched(page)).toBe(0);
      const roomId=await page.locator("#mr-root").getAttribute("data-room-id") ?? "";
      const st=await post(ctx.request,{roomId,action:"state"});
      const meetingId=viewOf(st).selectedMeetingId;
      const storeKey=(await ctx.cookies()).find(c=>c.name==="mr_store")?.value ?? "";
      ingest(svc,storeKey,roomId,{meetingId,utteranceId:"u11",sequence:1,revision:1,speaker:"a",text:"hi"});
      const p0=fake.pending[0]; expect(p0).toBeDefined(); if(p0===undefined) throw new Error("no pending reasoner call"); p0.resolve({status:"provisional",meetingId,contextRevision:9,subject:"HiddenSub",body:"HiddenBody",sourceRefs:[{utteranceId:"u11",revision:1}],note:"n"});
      let captured=false; const cap=holdFirstStateDeferred();
      await page.route(`${base}${API}`,async route=>{ const d=route.request().postData() ?? ""; if(d.includes('"action":"state"')&&captured===false){captured=true; const resp=await route.fetch(); cap.resolve({route,resp}); return;} await route.continue();});
      let apiReqs=0; page.on("request",r=>{ if(isApi(r.url())) apiReqs+=1; });
      await page.clock.runFor(POLL_INTERVAL+500); const held=await cap.promise;
      expect(await stateDispatched(page)).toBe(1);
      const bodyText=await held.resp.text(); expect(bodyText).toContain('"status":"provisional"'); expect(bodyText).toContain("HiddenSub"); expect(bodyText).toContain("HiddenBody");
      await page.evaluate("Object.defineProperty(document,\"visibilityState\",{get:()=>\"hidden\",configurable:true}); document.dispatchEvent(new Event(\"visibilitychange\"))");
      await flush(page);
      const req=held.route.request(); const delivered=page.waitForResponse(r=>r.request()===req);
      await held.route.fulfill({response:held.resp}); const got=await delivered; await got.finished(); await flush(page);
      expect((await page.locator("#mr-candidate-panel").textContent()) ?? "").not.toContain("HiddenSub");
      const beforeDispatched=await stateDispatched(page); const beforeApi=apiReqs;
      await page.clock.runFor(6*POLL_INTERVAL); await flush(page);
      expect(await stateDispatched(page)).toBe(beforeDispatched); expect(apiReqs).toBe(beforeApi); expect(await stateOutstanding(page)).toBe(0);
      expect(violations.length).toBe(0);
    } finally { await ctx.close(); await new Promise<void>(r=>server.close(()=>r())); }
  },60_000);
  it("regression(b) pagehide-only stop discards held poll without repaint or restart",async()=>{
    const fake=createFake();
    const svc=createMeetingRoomService({env:TEST_ENV,conversationInput:true,sessionPolicy:true,candidateReasoner:fake.reasoner});
    const server=createWebServer({meetingRoom:svc});
    await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
    base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const ctx=await browser.newContext(); const violations=await installLoopbackGuard(ctx); const page=await ctx.newPage();
    try{
      await installClockBeforeGoto(page);
      expect(await stateDispatched(page)).toBe(0);
      const roomId=await page.locator("#mr-root").getAttribute("data-room-id") ?? "";
      const st=await post(ctx.request,{roomId,action:"state"});
      const meetingId=viewOf(st).selectedMeetingId;
      const storeKey=(await ctx.cookies()).find(c=>c.name==="mr_store")?.value ?? "";
      ingest(svc,storeKey,roomId,{meetingId,utteranceId:"u11",sequence:1,revision:1,speaker:"a",text:"hi"});
      const p0=fake.pending[0]; expect(p0).toBeDefined(); if(p0===undefined) throw new Error("no pending reasoner call"); p0.resolve({status:"provisional",meetingId,contextRevision:9,subject:"HiddenSub",body:"HiddenBody",sourceRefs:[{utteranceId:"u11",revision:1}],note:"n"});
      let captured=false; const cap=holdFirstStateDeferred();
      await page.route(`${base}${API}`,async route=>{ const d=route.request().postData() ?? ""; if(d.includes('"action":"state"')&&captured===false){captured=true; const resp=await route.fetch(); cap.resolve({route,resp}); return;} await route.continue();});
      let apiReqs=0; page.on("request",r=>{ if(isApi(r.url())) apiReqs+=1; });
      await page.clock.runFor(POLL_INTERVAL+500); const held=await cap.promise;
      expect(await stateDispatched(page)).toBe(1);
      const bodyText=await held.resp.text(); expect(bodyText).toContain('"status":"provisional"'); expect(bodyText).toContain("HiddenSub"); expect(bodyText).toContain("HiddenBody");
      await page.evaluate("window.dispatchEvent(new Event(\"pagehide\"))");
      await flush(page);
      const req=held.route.request(); const delivered=page.waitForResponse(r=>r.request()===req);
      await held.route.fulfill({response:held.resp}); const got=await delivered; await got.finished(); await flush(page);
      expect((await page.locator("#mr-candidate-panel").textContent()) ?? "").not.toContain("HiddenSub");
      const beforeDispatched=await stateDispatched(page); const beforeApi=apiReqs;
      await page.clock.runFor(6*POLL_INTERVAL); await flush(page);
      expect(await stateDispatched(page)).toBe(beforeDispatched); expect(apiReqs).toBe(beforeApi); expect(await stateOutstanding(page)).toBe(0);
      expect(violations.length).toBe(0);
    } finally { await ctx.close(); await new Promise<void>(r=>server.close(()=>r())); }
  },60_000);
  it("regression(b) visible control renders the same held payload",async()=>{
    const fake=createFake();
    const svc=createMeetingRoomService({env:TEST_ENV,conversationInput:true,sessionPolicy:true,candidateReasoner:fake.reasoner});
    const server=createWebServer({meetingRoom:svc});
    await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
    base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const ctx=await browser.newContext(); const violations=await installLoopbackGuard(ctx); const page=await ctx.newPage();
    try{
      await installClockBeforeGoto(page);
      expect(await stateDispatched(page)).toBe(0);
      const roomId=await page.locator("#mr-root").getAttribute("data-room-id") ?? "";
      const st=await post(ctx.request,{roomId,action:"state"});
      const meetingId=viewOf(st).selectedMeetingId;
      const storeKey=(await ctx.cookies()).find(c=>c.name==="mr_store")?.value ?? "";
      ingest(svc,storeKey,roomId,{meetingId,utteranceId:"u11",sequence:1,revision:1,speaker:"a",text:"hi"});
      const p0=fake.pending[0]; expect(p0).toBeDefined(); if(p0===undefined) throw new Error("no pending reasoner call"); p0.resolve({status:"provisional",meetingId,contextRevision:9,subject:"HiddenSub",body:"HiddenBody",sourceRefs:[{utteranceId:"u11",revision:1}],note:"n"});
      let captured=false; const cap=holdFirstStateDeferred();
      await page.route(`${base}${API}`,async route=>{ const d=route.request().postData() ?? ""; if(d.includes('"action":"state"')&&captured===false){captured=true; const resp=await route.fetch(); cap.resolve({route,resp}); return;} await route.continue();});
      await page.clock.runFor(POLL_INTERVAL+500); const held=await cap.promise;
      expect(await stateDispatched(page)).toBe(1);
      const bodyText=await held.resp.text(); expect(bodyText).toContain('"status":"provisional"'); expect(bodyText).toContain("HiddenSub"); expect(bodyText).toContain("HiddenBody");
      const req=held.route.request(); const delivered=page.waitForResponse(r=>r.request()===req);
      await held.route.fulfill({response:held.resp}); const got=await delivered; await got.finished(); await flush(page);
      expect((await page.locator("#mr-candidate-panel").textContent()) ?? "").toContain("HiddenSub");
      expect((await page.locator("#mr-candidate-panel").textContent()) ?? "").toContain("HiddenBody");
      expect(violations.length).toBe(0);
    } finally { await ctx.close(); await new Promise<void>(r=>server.close(()=>r())); }
  },60_000);

  it("regression(c) reload while taken over makes zero state polls",async()=>{
    const fake=createFake();
    const svc=createMeetingRoomService({env:TEST_ENV,conversationInput:true,sessionPolicy:true,candidateReasoner:fake.reasoner});
    const server=createWebServer({meetingRoom:svc});
    await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
    base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const ctx=await browser.newContext(); const violations=await installLoopbackGuard(ctx); const page=await ctx.newPage();
    try{
      await installClockBeforeGoto(page);
      expect(await stateDispatched(page)).toBe(0);
      expect(await page.locator("#takeover").isDisabled()).toBe(false);
      const res=await clickAndWait(page,"#takeover");
      const j:unknown=await res.json();
      expect(viewOf({json:j as Record<string,unknown>}).twinStatus).toBe("paused (you took over)");
      await flush(page);
      let stateReqs=0; page.on("request",r=>{ if(isApi(r.url()) && (r.postData() ?? "").includes('"action":"state"')) stateReqs+=1; });
      await page.reload();
      await flush(page);
      expect(await page.locator("#resume").count()).toBe(1);
      const baseDisp=await stateDispatched(page);
      const baseReqs=stateReqs;
      await page.clock.runFor(6*POLL_INTERVAL); await flush(page);
      expect(await stateDispatched(page)).toBe(baseDisp);
      expect(stateReqs).toBe(baseReqs);
      expect(await stateOutstanding(page)).toBe(0);
      expect(violations.length).toBe(0);
    } finally { await ctx.close(); await new Promise<void>(r=>server.close(()=>r())); }
  },60_000);
  it("regression(c) takeover then hide/show makes zero new polls",async()=>{
    const fake=createFake();
    const svc=createMeetingRoomService({env:TEST_ENV,conversationInput:true,sessionPolicy:true,candidateReasoner:fake.reasoner});
    const server=createWebServer({meetingRoom:svc});
    await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
    base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const ctx=await browser.newContext(); const violations=await installLoopbackGuard(ctx); const page=await ctx.newPage();
    try{
      await installClockBeforeGoto(page);
      expect(await stateDispatched(page)).toBe(0);
      expect(await page.locator("#takeover").isDisabled()).toBe(false);
      const res=await clickAndWait(page,"#takeover");
      const j:unknown=await res.json();
      expect(viewOf({json:j as Record<string,unknown>}).twinStatus).toBe("paused (you took over)");
      await flush(page);
      let stateReqs=0; page.on("request",r=>{ if(isApi(r.url()) && (r.postData() ?? "").includes('"action":"state"')) stateReqs+=1; });
      const baseDisp=await stateDispatched(page);
      const baseReqs=stateReqs;
      await page.evaluate("Object.defineProperty(document,\"visibilityState\",{get:()=>\"hidden\",configurable:true}); document.dispatchEvent(new Event(\"visibilitychange\"))");
      await flush(page);
      await page.evaluate("Object.defineProperty(document,\"visibilityState\",{get:()=>\"visible\",configurable:true}); document.dispatchEvent(new Event(\"visibilitychange\"))");
      await flush(page);
      await page.clock.runFor(6*POLL_INTERVAL); await flush(page);
      expect(await stateDispatched(page)).toBe(baseDisp);
      expect(stateReqs).toBe(baseReqs);
      expect(await stateOutstanding(page)).toBe(0);
      expect(violations.length).toBe(0);
    } finally { await ctx.close(); await new Promise<void>(r=>server.close(()=>r())); }
  },60_000);
  it("regression(c) acknowledged resume restores exactly one poll loop",async()=>{
    const fake=createFake();
    const svc=createMeetingRoomService({env:TEST_ENV,conversationInput:true,sessionPolicy:true,candidateReasoner:fake.reasoner});
    const server=createWebServer({meetingRoom:svc});
    await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
    base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const ctx=await browser.newContext(); const violations=await installLoopbackGuard(ctx); const page=await ctx.newPage();
    try{
      await installClockBeforeGoto(page);
      expect(await page.locator("#takeover").isDisabled()).toBe(false);
      const resTk=await clickAndWait(page,"#takeover");
      const jTk:unknown=await resTk.json();
      expect(viewOf({json:jTk as Record<string,unknown>}).twinStatus).toBe("paused (you took over)");
      await flush(page);
      let stateReqs=0; page.on("request",r=>{ if(isApi(r.url()) && (r.postData() ?? "").includes('"action":"state"')) stateReqs+=1; });
      await page.evaluate("Object.defineProperty(document,\"visibilityState\",{get:()=>\"hidden\",configurable:true}); document.dispatchEvent(new Event(\"visibilitychange\"))");
      await page.evaluate("Object.defineProperty(document,\"visibilityState\",{get:()=>\"visible\",configurable:true}); document.dispatchEvent(new Event(\"visibilitychange\"))");
      const baseDisp0=await stateDispatched(page);
      const baseReqs0=stateReqs;
      await page.clock.runFor(6*POLL_INTERVAL); await flush(page);
      expect(await stateDispatched(page)).toBe(baseDisp0);
      expect(stateReqs).toBe(baseReqs0);
      expect(await page.locator("#resume").count()).toBe(1);
      expect(await page.locator("#resume").isDisabled()).toBe(false);
      const resRs=await clickAndWait(page,"#resume");
      const jRs:unknown=await resRs.json();
      expect(viewOf({json:jRs as Record<string,unknown>}).twinStatus).toBe("active");
      await flush(page);
      const beforeResume=await stateDispatched(page);
      const beforeReqs=stateReqs;
      const pending1=page.waitForResponse(r=>isApi(r.url())&&(r.request().postData() ?? "").includes('"action":"state"'));
      await page.clock.runFor(POLL_INTERVAL+500); await flush(page);
      const r1=await pending1; await r1.finished(); await flush(page);
      expect(await stateDispatched(page)).toBe(beforeResume+1);
      expect(stateReqs).toBe(beforeReqs+1);
      expect(await stateOutstanding(page)).toBe(0);
      for(let i=0;i<2;i++){
        const bDisp=await stateDispatched(page);
        const bReqs=stateReqs;
        const pend=page.waitForResponse(r=>isApi(r.url())&&(r.request().postData() ?? "").includes('"action":"state"'));
        await page.clock.runFor(POLL_INTERVAL); await flush(page);
        const rr=await pend; await rr.finished(); await flush(page);
        expect(await stateDispatched(page)).toBe(bDisp+1);
        expect(stateReqs).toBe(bReqs+1);
        expect(await stateOutstanding(page)).toBe(0);
      }
      expect(await stateOutstanding(page) <= 1).toBe(true);
      expect(violations.length).toBe(0);
    } finally { await ctx.close(); await new Promise<void>(r=>server.close(()=>r())); }
  },60_000);

  it("lifetime(a) delivered candidate update after 60s and more than 30 completed polls",async()=>{
    const fake=createFake();
    const svc=createMeetingRoomService({env:TEST_ENV,conversationInput:true,sessionPolicy:true,candidateReasoner:fake.reasoner});
    const server=createWebServer({meetingRoom:svc});
    await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
    base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const ctx=await browser.newContext(); const violations=await installLoopbackGuard(ctx); const page=await ctx.newPage();
    try{
      const fin=trackStateFinished(page);
      await installClockBeforeGoto(page);
      await page.waitForSelector("#mr-candidate-panel");
      for(let i=0;i<40;i++){
        const b=await stateDispatched(page);
        await page.clock.runFor(POLL_INTERVAL); await flush(page);
        expect(await stateDispatched(page)).toBe(b+1);
        await fin.until(b+1); await flush(page);
      }
      const roomId=(await page.locator("#mr-root").getAttribute("data-room-id")) ?? "";
      expect(roomId).toBeTruthy();
      const storeKey=(await ctx.cookies()).find(c=>c.name==="mr_store")?.value ?? "";
      expect(storeKey).toBeTruthy();
      const st=await post(ctx.request,{roomId,action:"state"});
      const meetingId=viewOf(st).selectedMeetingId;
      const SUBJ="Sub Lifetime A";
      const BODY="Body Lifetime A";
      ingest(svc,storeKey,roomId,{meetingId,utteranceId:"u1",sequence:1,revision:1,speaker:"a",text:"hello"});
      const pend=fake.pending[0];
      if(pend) pend.resolve({status:"provisional",meetingId,contextRevision:1,subject:SUBJ,body:BODY,sourceRefs:[{utteranceId:"u1",revision:1}],note:"ok"});
      const b2=await stateDispatched(page);
      await page.clock.runFor(POLL_INTERVAL); await flush(page);
      expect(await stateDispatched(page)).toBe(b2+1);
      await fin.until(b2+1); await flush(page);
      const txt=(await page.locator("#mr-candidate-panel").textContent()) ?? "";
      expect(txt).toContain(SUBJ);
      expect(txt).toContain(BODY);
      expect(txt).toContain("not policy-checked");
      expect(await page.locator("#mr-candidate-expired").count()).toBe(0);
      expect(violations.length).toBe(0);
    } finally { await ctx.close(); await new Promise<void>(r=>server.close(()=>r())); }
  },60_000);
  it("lifetime(b) 10-minute deadline pauses updates, discards held result, hide/show cannot renew",async()=>{
    const fake=createFake();
    const svc=createMeetingRoomService({env:TEST_ENV,conversationInput:true,sessionPolicy:true,candidateReasoner:fake.reasoner});
    const server=createWebServer({meetingRoom:svc});
    await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
    base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const ctx=await browser.newContext(); const violations=await installLoopbackGuard(ctx); const page=await ctx.newPage();
    try{
      const fin=trackStateFinished(page);
      await installClockBeforeGoto(page);
      await page.waitForSelector("#mr-candidate-panel");
      for(let i=0;i<2;i++){
        const b=await stateDispatched(page);
        await page.clock.runFor(POLL_INTERVAL); await flush(page);
        expect(await stateDispatched(page)).toBe(b+1);
        await fin.until(b+1); await flush(page);
      }
      await page.evaluate("Object.defineProperty(document,\"visibilityState\",{get:()=>\"hidden\",configurable:true}); document.dispatchEvent(new Event(\"visibilitychange\"))");
      await flush(page);
      await page.evaluate("Object.defineProperty(document,\"visibilityState\",{get:()=>\"visible\",configurable:true}); document.dispatchEvent(new Event(\"visibilitychange\"))");
      await flush(page);
      const b3=await stateDispatched(page);
      await page.clock.runFor(POLL_INTERVAL); await flush(page);
      expect(await stateDispatched(page)).toBe(b3+1);
      await fin.until(b3+1); await flush(page);
      await page.clock.runFor(597000-3*POLL_INTERVAL); await flush(page);
      const bd=await stateDispatched(page);
      expect(bd).toBe(b3+2);
      await fin.until(bd); await flush(page);
      const roomId2=(await page.locator("#mr-root").getAttribute("data-room-id")) ?? "";
      const storeKey2=(await ctx.cookies()).find(c=>c.name==="mr_store")?.value ?? "";
      const st2=await post(ctx.request,{roomId:roomId2,action:"state"});
      const meetingId2=viewOf(st2).selectedMeetingId;
      const SUBJ2="Sub Lifetime B";
      const BODY2="Body Lifetime B";
      ingest(svc,storeKey2,roomId2,{meetingId:meetingId2,utteranceId:"u1",sequence:1,revision:1,speaker:"a",text:"hello"});
      const p2=fake.pending[0];
      if(p2) p2.resolve({status:"provisional",meetingId:meetingId2,contextRevision:1,subject:SUBJ2,body:BODY2,sourceRefs:[{utteranceId:"u1",revision:1}],note:"ok"});
      let held:{route:Route;resp:APIResponse}|undefined;
      const cap=deferred<void>();
      await page.route(`${base}${API}`,async route=>{
        const d=route.request().postData()??"";
        if(d.includes('"action":"state"')&&held===undefined){ const resp=await route.fetch(); held={route,resp}; cap.resolve(); return; }
        await route.continue();
      });
      const beforeHold=await stateDispatched(page);
      await page.clock.runFor(POLL_INTERVAL); await flush(page);
      expect(await stateDispatched(page)).toBe(beforeHold+1);
      await cap.promise;
      await page.clock.runFor(5*POLL_INTERVAL); await flush(page);
      expect(await page.locator("#mr-candidate-expired").count()).toBe(1);
      expect((await page.locator("#mr-candidate-expired").textContent()) ?? "").toMatch(/paused/i);
      expect((await page.locator("#mr-candidate-expired").textContent()) ?? "").toMatch(/refresh/i);
      const dispAtExpiry=await stateDispatched(page);
      const heldCopy=held;
      if(heldCopy){ await heldCopy.route.fulfill({response:heldCopy.resp}); }
      await fin.until(dispAtExpiry); await flush(page);
      const txt2=(await page.locator("#mr-candidate-panel").textContent()) ?? "";
      expect(txt2).not.toContain(SUBJ2);
      expect(await page.locator("#mr-candidate-expired").count()).toBe(1);
      expect(txt2).toContain("not policy-checked");
      await page.clock.runFor(6*POLL_INTERVAL); await flush(page);
      expect(await stateDispatched(page)).toBe(dispAtExpiry);
      await page.evaluate("Object.defineProperty(document,\"visibilityState\",{get:()=>\"hidden\",configurable:true}); document.dispatchEvent(new Event(\"visibilitychange\"))");
      await flush(page);
      await page.evaluate("Object.defineProperty(document,\"visibilityState\",{get:()=>\"visible\",configurable:true}); document.dispatchEvent(new Event(\"visibilitychange\"))");
      await flush(page);
      await page.clock.runFor(6*POLL_INTERVAL); await flush(page);
      expect(await stateDispatched(page)).toBe(dispAtExpiry);
      expect(await stateOutstanding(page)).toBe(0);
      expect(await page.locator("#mr-candidate-expired").count()).toBe(1);
      expect(violations.length).toBe(0);
    } finally { await ctx.close(); await new Promise<void>(r=>server.close(()=>r())); }
  },60_000);
  it("failure(abort-recovery) network abort shows unavailable then recovers",async()=>{
    const fake=createFake();
    const svc=createMeetingRoomService({env:TEST_ENV,conversationInput:true,sessionPolicy:true,candidateReasoner:fake.reasoner});
    const server=createWebServer({meetingRoom:svc});
    await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
    base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const ctx=await browser.newContext(); const violations=await installLoopbackGuard(ctx); const page=await ctx.newPage();
    try{
      const fin=trackStateFinished(page);
      let abortNext=false; await page.route(`${base}${API}`,async route=>{ if(abortNext&&(route.request().postData()??"").includes('"action":"state"')){ abortNext=false; await route.abort(); return; } await route.continue(); });
      await installClockBeforeGoto(page);
      const roomId=await page.locator("#mr-root").getAttribute("data-room-id") ?? "";
      const st=await post(ctx.request,{roomId,action:"state"});
      const meetingId=viewOf(st).selectedMeetingId;
      const key=await ctx.cookies().then(c=>c.find(x=>x.name==="mr_store")?.value ?? "");
      const SUBJ="Sub Abort Rec"; const BODY="Body Abort Rec";
      ingest(svc,key,roomId,{meetingId,utteranceId:"u1",sequence:1,revision:1,speaker:"a",text:"hello"});
      const p0=fake.pending[0]; expect(p0).toBeDefined(); if(p0===undefined) throw new Error("no pending"); p0.resolve({status:"provisional",meetingId,contextRevision:1,subject:SUBJ,body:BODY,sourceRefs:[{utteranceId:"u1",revision:1}],note:"n"});
      const d0=await stateDispatched(page); await page.clock.runFor(POLL_INTERVAL); await flush(page); expect(await stateDispatched(page)).toBe(d0+1);
      await fin.until(1); await flush(page);
      expect((await page.locator("#mr-candidate-panel").textContent())??"").toContain(SUBJ);
      await page.locator("#package-editor").fill("dirty keep");
      const disA=await page.locator("#approve").isDisabled(); const disS=await page.locator("#send").isDisabled();
      expect(disA).toBe(true); expect(disS).toBe(true);
      const b=await stateDispatched(page);
      const failedP=page.waitForEvent("requestfailed",{predicate:req=>req.url()===`${base}${API}`&&(req.postData()??"").includes('"action":"state"'),timeout:10_000});
      abortNext=true; await page.clock.runFor(POLL_INTERVAL); await flush(page);
      expect(await stateDispatched(page)).toBe(b+1);
      await failedP; await flush(page); expect(await stateOutstanding(page)).toBe(0);
      expect(await page.locator("#mr-candidate-unavailable").count()).toBe(1);
      expect((await page.locator("#mr-candidate-panel").textContent())??"").toContain("not policy-checked");
      expect((await page.locator("#mr-candidate-panel").textContent())??"").toContain(SUBJ);
      expect(await page.locator("#package-editor").inputValue()).toBe("dirty keep");
      expect(await page.locator("#approve").isDisabled()).toBe(disA); expect(await page.locator("#send").isDisabled()).toBe(disS);
      await page.clock.runFor(POLL_INTERVAL-1); await flush(page); expect(await stateDispatched(page)).toBe(b+1);
      const f0=fin.count(); await page.clock.runFor(1); await flush(page); expect(await stateDispatched(page)).toBe(b+2);
      await fin.until(f0+1); await flush(page);
      expect(await page.locator("#mr-candidate-unavailable").count()).toBe(0);
      expect((await page.locator("#mr-candidate-panel").textContent())??"").toContain(SUBJ);
      expect((await page.locator("#mr-candidate-panel").textContent())??"").toContain(BODY);
      expect(await page.locator("#package-editor").inputValue()).toBe("dirty keep");
      expect(await page.locator("#approve").isDisabled()).toBe(true); expect(await page.locator("#send").isDisabled()).toBe(true);
      expect(violations.length).toBe(0);
    } finally { await ctx.close(); await new Promise<void>(r=>server.close(()=>r())); }
  },60_000);
  it("failure(http500-recovery) 500 non-JSON shows unavailable then recovers",async()=>{
    const fake=createFake();
    const svc=createMeetingRoomService({env:TEST_ENV,conversationInput:true,sessionPolicy:true,candidateReasoner:fake.reasoner});
    const server=createWebServer({meetingRoom:svc});
    await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
    base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const ctx=await browser.newContext(); const violations=await installLoopbackGuard(ctx); const page=await ctx.newPage();
    try{
      const fin=trackStateFinished(page);
      let fail500=false; await page.route(`${base}${API}`,async route=>{ if(fail500&&(route.request().postData()??"").includes('"action":"state"')){ fail500=false; await route.fulfill({status:500,contentType:"text/plain",body:"ERR500 not json"}); return; } await route.continue(); });
      await installClockBeforeGoto(page);
      const roomId=await page.locator("#mr-root").getAttribute("data-room-id") ?? "";
      const st=await post(ctx.request,{roomId,action:"state"});
      const meetingId=viewOf(st).selectedMeetingId;
      const key=await ctx.cookies().then(c=>c.find(x=>x.name==="mr_store")?.value ?? "");
      const SUBJ="Sub 500 Rec"; const BODY="Body 500 Rec";
      ingest(svc,key,roomId,{meetingId,utteranceId:"u1",sequence:1,revision:1,speaker:"a",text:"hello"});
      const p0=fake.pending[0]; expect(p0).toBeDefined(); if(p0===undefined) throw new Error("no pending"); p0.resolve({status:"provisional",meetingId,contextRevision:1,subject:SUBJ,body:BODY,sourceRefs:[{utteranceId:"u1",revision:1}],note:"n"});
      const d0=await stateDispatched(page); await page.clock.runFor(POLL_INTERVAL); await flush(page); expect(await stateDispatched(page)).toBe(d0+1);
      await fin.until(1); await flush(page);
      expect((await page.locator("#mr-candidate-panel").textContent())??"").toContain(SUBJ);
      await page.locator("#package-editor").fill("dirty keep");
      const disA=await page.locator("#approve").isDisabled(); const disS=await page.locator("#send").isDisabled();
      expect(disA).toBe(true); expect(disS).toBe(true);
      const b=await stateDispatched(page);
      const f0=fin.count();
      const failedResp=page.waitForEvent("response",{predicate:res=>res.url()===`${base}${API}`&&res.status()===500,timeout:10_000});
      fail500=true; await page.clock.runFor(POLL_INTERVAL); await flush(page);
      expect(await stateDispatched(page)).toBe(b+1);
      await failedResp; await fin.until(f0+1); await flush(page); expect(await stateOutstanding(page)).toBe(0);
      expect(await page.locator("#mr-candidate-unavailable").count()).toBe(1);
      expect((await page.locator("#mr-candidate-unavailable").textContent())??"").toMatch(/unavailable/i);
      expect((await page.locator("#mr-candidate-unavailable").textContent())??"").toMatch(/stale/i);
      expect((await page.locator("#mr-candidate-panel").textContent())??"").toContain("not policy-checked");
      expect((await page.locator("#mr-candidate-panel").textContent())??"").toContain(SUBJ);
      expect((await page.locator("#mr-candidate-panel").textContent())??"").not.toContain("ERR500");
      expect(await page.locator("#package-editor").inputValue()).toBe("dirty keep");
      expect(await page.locator("#approve").isDisabled()).toBe(disA); expect(await page.locator("#send").isDisabled()).toBe(disS);
      await page.clock.runFor(POLL_INTERVAL-1); await flush(page); expect(await stateDispatched(page)).toBe(b+1);
      const f1=fin.count(); await page.clock.runFor(1); await flush(page); expect(await stateDispatched(page)).toBe(b+2);
      await fin.until(f1+1); await flush(page);
      expect(await page.locator("#mr-candidate-unavailable").count()).toBe(0);
      expect((await page.locator("#mr-candidate-panel").textContent())??"").toContain(SUBJ);
      expect((await page.locator("#mr-candidate-panel").textContent())??"").toContain(BODY);
      expect(await page.locator("#package-editor").inputValue()).toBe("dirty keep");
      expect(await page.locator("#approve").isDisabled()).toBe(true); expect(await page.locator("#send").isDisabled()).toBe(true);
      expect(violations.length).toBe(0);
    } finally { await ctx.close(); await new Promise<void>(r=>server.close(()=>r())); }
  },60_000);
});
