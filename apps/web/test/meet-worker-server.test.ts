import { expect, test } from "vitest";
import { createServer, type Server as NodeServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createWebServer } from "../src/server.js";
import { createOwnerMeetRuntime, type StartCapture } from "../src/ownerMeetRuntime.js";
import type { Capture } from "../src/meetWorkerBridge.js";
type Scope = Parameters<StartCapture>[0];
type TypedCapture = Capture;
function deferred<T>(){let resolve!:(v:T)=>void;let reject!:(e:unknown)=>void;const promise=new Promise<T>((res,rej)=>{resolve=res;reject=rej;});return {promise,resolve,reject};}
async function listen(server: NodeServer): Promise<string>{
 await new Promise<void>(r=>server.listen(0,"127.0.0.1",()=>r()));
 const a=server.address();if(!a||typeof a==="string") throw new Error("no port");return `http://127.0.0.1:${(a as {port:number}).port}`;
}
async function closeServer(s: NodeServer): Promise<void>{
 if(!s.listening) return;
 s.closeAllConnections();
 await new Promise<void>((res,rej)=>s.close(e=>e?rej(e):res()));
}
function setup(opts:{sampleImpl?:(scope:Scope)=>ReturnType<Capture["sample"]>}={}){
 let tickFn:()=>void=()=>{};
 const entered=deferred<Scope>();
 let launchCount=0;let closeCount=0;
 let sampleImpl: (scope:Scope)=>ReturnType<Capture["sample"]>=opts.sampleImpl ?? (()=>Promise.resolve([]));
 const fakeCapture: StartCapture = (scope:Scope): Promise<TypedCapture> => {
  launchCount++;if(launchCount===1) entered.resolve(scope);
  return Promise.resolve({ sample:()=>sampleImpl(scope), stop:()=>{ closeCount++;return Promise.resolve(); } });
 };
 let inner: ReturnType<typeof createWebServer> | null = null;
 const front=createServer((req,res)=>{ if(inner) inner.emit("request",req,res); else { res.statusCode=503;res.end(); } });
 const readyPromise=(async ()=>{
  const origin=await listen(front);
  const runtime=createOwnerMeetRuntime({ origin, startCapture: fakeCapture, schedule:(tick)=>{ tickFn=tick;return ()=>{}; } });
  inner=createWebServer(runtime);
  return { runtime, origin };
 })();
 return {
  front, get inner(){return inner;}, readyPromise, enteredScope:entered,
  getLaunchCount(){return launchCount;}, getCloseCount(){return closeCount;}, tick:()=>tickFn(),
  setSample(fn:(scope:Scope)=>ReturnType<Capture["sample"]>){ sampleImpl=fn; },
  async close(){ try{ const r=await readyPromise;await r.runtime.dispose(); } finally{ await closeServer(front); } }
 };
}
test("real server worker HTTP boundaries",async ()=>{
 const h=setup();let ready:{runtime:Awaited<ReturnType<typeof createOwnerMeetRuntime>>;origin:string}|null=null;
 try{
  ready=await h.readyPromise;
  const { origin }=ready;
  const res=await fetch(origin+"/meeting-room");expect(res.status).toBe(200);
  const html=await res.text();expect(html).toContain('data-meet-worker="1"');expect(html).toContain('data-google-connect="0"');
  const m=/id="mr-root" data-room-id="([^"]+)"/.exec(html);if(!m?.[1]) throw new Error("no roomId");const roomId=m[1];
  const setCookie=res.headers.get("set-cookie");if(!setCookie) throw new Error("no cookie");const cookie=setCookie.split(";")[0]!;
  const post=(body:unknown,opts:{origin?:string,cookie?:string}={})=>fetch(origin+"/api/meeting-room/worker/connect",{method:"POST",headers:{"Cookie":opts.cookie??cookie,"Origin":opts.origin??origin,"Content-Type":"application/json"},body:JSON.stringify(body)});
  const good={ roomId, meetingUrl:"https://meet.google.com/abc-defg-hij", displayName:"AI twin (test)" };
  const r1=await post(good);expect(r1.status).toBe(202);await h.enteredScope.promise;expect(h.getLaunchCount()).toBe(1);
  const rWrong=await post(good,{origin:"http://evil.example"});expect(rWrong.status).toBe(403);expect(h.getLaunchCount()).toBe(1);
  const rNoCookie=await post(good,{cookie:""});expect(rNoCookie.status).toBe(401);expect(h.getLaunchCount()).toBe(1);
  const foreignRoomId=randomUUID();const fakeCookie=`mr_store=${foreignRoomId}`;
  const rForeign=await post(good,{cookie:fakeCookie});expect(rForeign.status).toBe(404);expect(h.getLaunchCount()).toBe(1);
  const rExtra=await post({...(good as Record<string,unknown>),extra:1});expect(rExtra.status).toBe(400);expect(h.getLaunchCount()).toBe(1);
  const st=await fetch(origin+`/api/meeting-room/worker/status?roomId=${encodeURIComponent(roomId)}`,{headers:{Cookie:cookie}});expect(st.status).toBe(200);
  const sj=await st.json() as {snapshot:{roomId:string},canPrepare:boolean};expect(sj.snapshot.roomId).toBe(roomId);
  const freshRes=await fetch(origin+"/meeting-room",{headers:{Cookie:cookie}});const freshHtml=await freshRes.text();
  const fm=/id="mr-root" data-room-id="([^"]+)"/.exec(freshHtml);  const freshRoom=fm?.[1];if(!freshRoom)throw new Error("missing fresh roomId");const stRes=await fetch(origin+"/api/meeting-room/worker/status?roomId="+encodeURIComponent(freshRoom),{headers:{Cookie:cookie}});expect(stRes.status).toBe(200);const stJson=await stRes.json() as {snapshot:{roomId:string}};expect(stJson.snapshot.roomId).toBe(freshRoom);
  expect(sj.canPrepare).toBe(false);
  const stForeign=await fetch(origin+`/api/meeting-room/worker/status?roomId=${encodeURIComponent(roomId)}`,{headers:{Cookie:fakeCookie}});expect(stForeign.status).toBe(404);
  const demo=await fetch(origin+"/meeting-room?demo=1",{headers:{Cookie:cookie}});expect(demo.status).toBe(200);
  const demoHtml=await demo.text();expect(demoHtml).toContain('data-meet-worker="0"');expect(demoHtml).toContain('data-google-connect="0"');
  const def=createWebServer();const defaultOrigin=await listen(def);
  try{ const dRes=await fetch(defaultOrigin+`/api/meeting-room/worker/status?roomId=${encodeURIComponent(roomId)}`);expect(dRes.status).toBe(404); } finally{ await closeServer(def); }
 } finally{ await h.close(); }
});
test("real Chrome worker review correction", async()=>{
  const [{chromium,expect:browserExpect},{existsSync},{vi}] = await Promise.all([import("@playwright/test"),import("node:fs"),import("vitest")]);
  const h=setup();
  const ready=await h.readyPromise;
  const {runtime,origin}=ready;
  const service=runtime.meetingRoom as unknown as {ingestConversationAs:(...a:unknown[])=>{status:number},finishConversationAs:(...a:unknown[])=>unknown};
  const original=service.ingestConversationAs.bind(service);
  const committed=deferred<ReturnType<typeof original>>();
  const finishSpy=vi.spyOn(service as unknown as Record<string,unknown> as {finishConversationAs:typeof service.finishConversationAs},"finishConversationAs");
  let constr: ReturnType<typeof original> | undefined;
  vi.spyOn(service as unknown as Record<string,unknown> as {ingestConversationAs:typeof service.ingestConversationAs},"ingestConversationAs").mockImplementation((...args:unknown[])=>{
    const r=original(...(args as Parameters<typeof original>));
    constr=r as unknown as typeof constr;
    if((r as unknown as {status:number}).status===200) committed.resolve(r as unknown as ReturnType<typeof original>);
    return r;
  });
  h.setSample((scope)=>Promise.resolve([{event:{version:1,meetingId:scope.binding.meetingId,utteranceId:"integrated-u1",sequence:1,revision:1,speaker:"Synthetic owner",text:"We can budget 700 for the project, pending confirmation of the date."},verified:false}]));
  const chromePath=process.env.PLAYWRIGHT_CHROME_PATH ?? (existsSync("/usr/bin/google-chrome")?"/usr/bin/google-chrome":undefined);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const urls:string[]=[];
  try{
    browser=await chromium.launch(chromePath?{executablePath:chromePath}:{});
    const page=await browser.newPage();
    page.on("request",(req)=>urls.push(req.url()));
    await page.route("**/*",(route)=>{ const u=new URL(route.request().url()); return u.origin===origin?route.continue():route.abort(); });
    await page.goto(origin+"/meeting-room");
    await browserExpect(page.locator("body")).toHaveAttribute("data-meet-worker","1");
    await browserExpect(page.locator("body")).toHaveAttribute("data-google-connect","0");
    const root=page.locator("#mr-root");
    await browserExpect(root).toBeVisible();
    const roomId=await root.getAttribute("data-room-id");
    if(!roomId) throw new Error("no roomId");
    await page.locator("#mr-meet-url").fill("https://meet.google.com/abc-defg-hij");
    await page.locator("#mr-meet-name").fill("AI twin (test)");
    await browserExpect(page.locator("#mr-meet-connect")).toBeEnabled();
    await page.locator("#mr-meet-connect").click();
    await browserExpect(page.locator("#mr-meet-status")).toContainText("Listening");
    expect(h.getLaunchCount()).toBe(1);
    await h.enteredScope.promise;
    h.tick();
    await committed.promise;
    const snap1=(constr as unknown as {body:{snapshot:{conversation:{contextRevision:number,utterances:{text:string}[]}}}}).body.snapshot;
    expect(snap1.conversation.contextRevision).toBe(1);
    expect(snap1.conversation.utterances[0]!.text).toContain("700");
    await page.locator("#mr-meet-stop").click();
    await browserExpect(page.locator("#mr-meet-status")).toContainText("Stopped");
    expect(h.getCloseCount()).toBe(1);
    const ta=page.locator("#mr-review-rows textarea");
    await browserExpect(ta).toHaveValue("We can budget 700 for the project, pending confirmation of the date.");
    await browserExpect(page.locator("#mr-review-rows")).toContainText("Unverified caption");
    const edited="We can budget 750 for the project; please confirm the meeting date before drafting.";
    await ta.fill(edited);
    const respPromise=page.waitForResponse((r)=>new URL(r.url()).pathname==="/api/meeting-room/worker/correct" && r.request().method()==="POST");
    await page.locator("#mr-review-rows").getByRole("button",{name:"Save correction"}).click();
    const resp=await respPromise;
    expect(resp.status()).toBe(200);
    const json=await resp.json() as {snapshot:{conversation:{contextRevision:number,utterances:{utteranceId:string,revision:number,text:string}[]}}};
    expect(json.snapshot.conversation.contextRevision).toBe(2);
    expect(json.snapshot.conversation.utterances[0]!.revision).toBe(2);
    expect(json.snapshot.conversation.utterances[0]!.text).toBe(edited);
    await browserExpect(ta).toHaveValue(edited);
    await browserExpect(page.locator("#mr-meet-prepare")).toBeDisabled();
    await browserExpect(root).toBeVisible();
    expect(await root.getAttribute("data-room-id")).toBe(roomId);
    expect(finishSpy).toHaveBeenCalledTimes(0);
    for(const u of urls) expect(new URL(u).origin).toBe(origin);
    expect(urls.filter((u)=>new URL(u).pathname==="/api/meeting-room/worker/correct").length).toBe(1);
    expect(urls.filter((u)=>new URL(u).pathname==="/api/meeting-room/worker/connect").length).toBe(1);
  } finally { try{ if(browser) await browser.close(); } catch{} vi.restoreAllMocks(); await h.close(); }
},40000);