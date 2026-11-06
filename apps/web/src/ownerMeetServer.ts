import { pathToFileURL } from "node:url";
import { resolve, relative, isAbsolute, sep, dirname, basename, join } from "node:path";
import { realpathSync, statSync } from "node:fs";
import { createWebServer } from "./server.js";
import { createOwnerMeetRuntime, type StartCapture } from "./ownerMeetRuntime.js";
import type { createGoogleConnections } from "./googleConnections.js";
import { createOwnerGoogleHttp } from "./ownerGoogleHttp.js";
import { createLocalMeetCaptureFactory, meetCaptureOptsFromEnv } from "./meetWorkerCapture.js";
import { WEB_ROOT } from "./loadFixtures.js";
import { createGoogleWriteOutbox } from "./googleWriteOutbox.js";
import { createOwnerDraftHttp } from "./ownerDraftHttp.js";
export type { StartCapture };
export function assertOwnerMeetCliEnvironment(env: Readonly<Record<string,string|undefined>>): void {
  const m=env["SECOND_SEAT_MODE"]; if(m!==undefined && m!=="offline") throw new Error("Owner Meet start failed");
  for(const k of ["SECOND_SEAT_TEST_MODE","LIVE_DEV","SECOND_SEAT_EXPERIMENTAL_IMAGES"] as const){ const v=env[k]; if(v!==undefined && v!=="0") throw new Error("Owner Meet start failed"); }
}
function validateEmail(e: string): void {
  if(typeof e!=="string" || e.trim().length===0 || e.length>320) throw new Error("Owner Meet start failed");
  if(/\p{Cc}/u.test(e)) throw new Error("Owner Meet start failed");
}
function validatePort(p: number|undefined): number {
  const v=p ?? 4173;
  if(!Number.isSafeInteger(v) || v<1024 || v>65535) throw new Error("Owner Meet start failed");
  return v;
}
function parseArgs(argv: string[]): { email: string; port?: number } {
  let email: string|undefined; let port: number|undefined;
  const seen=new Set<string>();
  for(let i=0;i<argv.length;i++){ const a=argv[i]!;
    if(a==="--owner-email"){ if(seen.has(a)) throw new Error("Owner Meet start failed"); seen.add(a); const v=argv[++i]; if(!v || v.startsWith("--")) throw new Error("Owner Meet start failed"); email=v; }
    else if(a==="--port"){ if(seen.has(a)) throw new Error("Owner Meet start failed"); seen.add(a); const v=argv[++i]; if(!v || v.startsWith("--")) throw new Error("Owner Meet start failed"); const n=Number(v); if(!Number.isSafeInteger(n)) throw new Error("Owner Meet start failed"); port=n; }
    else throw new Error("Owner Meet start failed");
  }
  if(!email) throw new Error("Owner Meet start failed");
  if(port===undefined) return {email};
  return {email,port};
}
export async function startOwnerMeetServer(opts: { expectedOwnerEmail: string; port?: number; chromePath?: string; startCapture?: StartCapture; googleConnections?: ReturnType<typeof createGoogleConnections>; googleJournalPath?: string; googleDraftFetch?: typeof fetch; candidateRuntime?: Parameters<typeof createOwnerMeetRuntime>[0]["candidateRuntime"]; canPrepare?: Parameters<typeof createOwnerMeetRuntime>[0]["canPrepare"] }): Promise<{ url: string; server: import("node:http").Server; runtime: ReturnType<typeof createOwnerMeetRuntime>; stop: () => Promise<void> }> {
  validateEmail(opts.expectedOwnerEmail);
  const port=validatePort(opts.port);
  const origin="http://localhost:"+String(port);
  let startCapture: StartCapture;
  if(typeof opts.startCapture==="function") startCapture=opts.startCapture;
  else {
    const fOpts: Parameters<typeof createLocalMeetCaptureFactory>[0]={ expectedOwnerEmail: opts.expectedOwnerEmail, ...meetCaptureOptsFromEnv(process.env), ...(opts.chromePath!==undefined?{ chromePath: opts.chromePath }:{}) };
    startCapture=createLocalMeetCaptureFactory(fOpts);
  }
  const checkout=resolve(WEB_ROOT,'../..');
  function isInsideCheckout(resolved: string): boolean {
    const rel=relative(checkout,resolved);
    return rel==='' || (!isAbsolute(rel) && rel!=='..' && !rel.startsWith('..'+sep));
  }
  let journalPath: string | undefined;
  if(opts.googleJournalPath!==undefined){
    if(opts.googleConnections===undefined) throw new Error("Owner Meet start failed");
    if(typeof opts.googleJournalPath!=="string" || !isAbsolute(opts.googleJournalPath) || opts.googleJournalPath.includes("\0")) throw new Error("Owner Meet start failed");
    const resolvedJournal=resolve(opts.googleJournalPath);
    if(resolvedJournal===checkout || isInsideCheckout(resolvedJournal)) throw new Error("Owner Meet start failed");
    journalPath=resolvedJournal;
  }
  let runtime: ReturnType<typeof createOwnerMeetRuntime>;
  try{ runtime=createOwnerMeetRuntime({origin,startCapture,...(opts.candidateRuntime!==undefined ? {candidateRuntime: opts.candidateRuntime} : {}),...(opts.canPrepare!==undefined ? {canPrepare: opts.canPrepare} : {})}); }catch{ throw new Error("Owner Meet start failed"); }
  let server: import("node:http").Server;
  try{
    let googleDraftHttp: ReturnType<typeof createOwnerDraftHttp> | undefined;
    if(journalPath!==undefined && opts.googleConnections!==undefined){
      const realParent=realpathSync(dirname(journalPath));
      if(realParent===checkout || isInsideCheckout(realParent)) throw new Error("Owner Meet start failed");
      if(!statSync(realParent).isDirectory()) throw new Error("Owner Meet start failed");
      journalPath=join(realParent,basename(journalPath));
      const outbox=createGoogleWriteOutbox({journalPath});
      googleDraftHttp=createOwnerDraftHttp({origin,service:runtime.meetingRoom,connections:opts.googleConnections,outbox,fetcher:opts.googleDraftFetch??fetch});
    }
    const googleHttp=opts.googleConnections!==undefined ? createOwnerGoogleHttp({origin,connections:opts.googleConnections}) : undefined; server=createWebServer({meetingRoom:runtime.meetingRoom,meetWorkerHttp:runtime.meetWorkerHttp,...(googleHttp!==undefined ? {googleHttp} : {}),...(googleDraftHttp!==undefined ? {googleDraftHttp} : {}),...(runtime.candidateApprovalApi!==undefined ? {candidateApprovalApi: runtime.candidateApprovalApi} : {})}); }catch{ let cleanupFailed=false; try{ await runtime.dispose(); }catch{ cleanupFailed=true; } throw new Error(cleanupFailed ? "Owner Meet cleanup unconfirmed" : "Owner Meet start failed"); }
  try{
    await new Promise<void>((resolve,reject)=>{
      const onL=()=>{ server.off("error",onE); resolve(); };
      const onE=(e:unknown)=>{ server.off("listening",onL); reject(e); };
      server.once("listening",onL); server.once("error",onE);
      try{ server.listen(port,"127.0.0.1"); }catch(e){ server.off("listening",onL); server.off("error",onE); reject(e); }
    });
  }catch{
    let cleanupFailed=false;
    try{ await runtime.dispose(); }catch{ cleanupFailed=true; }
    try{
      await new Promise<void>((resolve,reject)=>{
        try{
          const s=server as unknown as { listening: boolean; close:(cb:(e?:Error)=>void)=>void };
          if(!s.listening) resolve();
          else s.close((e)=>e?reject(e):resolve());
        }catch(e){ reject(e as Error); }
      });
    }catch{ cleanupFailed=true; }
    throw new Error(cleanupFailed ? "Owner Meet cleanup unconfirmed" : "Owner Meet start failed");
  }
  const url=origin+"/meeting-room";
  let cached: Promise<void>|null=null;
  const stop=(): Promise<void>=>{
    if(cached!==null) return cached;
    let disposeP: Promise<void>; try{ disposeP=runtime.dispose(); }catch(e){ disposeP=Promise.reject(e); }
    cached=disposeP.then(()=>new Promise<void>((resolve,reject)=>{
      try{
        const s=server as unknown as { listening: boolean; close:(cb:(e?:Error)=>void)=>void };
        if(!s.listening) resolve();
        else s.close((e)=>e?reject(e):resolve());
      }catch(e){ reject(e as Error); }
    }),()=>new Promise<void>((resolve,reject)=>{
      try{
        const s=server as unknown as { listening: boolean; close:(cb:(e?:Error)=>void)=>void };
        if(!s.listening) reject(new Error("Owner Meet cleanup unconfirmed"));
        else s.close((e)=>reject(e ?? new Error("Owner Meet cleanup unconfirmed")));
      }catch{ reject(new Error("Owner Meet cleanup unconfirmed")); }
    })).catch(()=>{ throw new Error("Owner Meet cleanup unconfirmed"); });
    cached.catch(()=>{});
    return cached;
  };
  const ret={url,server,runtime,stop};
  return Object.freeze(ret) as typeof ret;
}
const isMain=process.argv[1]!==undefined && import.meta.url===pathToFileURL(process.argv[1]!).href;
if(isMain){
  let parsed: { email: string; port?: number } | undefined = undefined;
  try{ assertOwnerMeetCliEnvironment(process.env); parsed=parseArgs(process.argv.slice(2)); }catch{ process.exitCode=1; };
  let stopping=false;
  let api: Awaited<ReturnType<typeof startOwnerMeetServer>> | undefined;
  const bootPromise=(async()=>{
    if(parsed===undefined || process.exitCode===1) return;
    try{
      const startArgs: { expectedOwnerEmail: string; port?: number }={ expectedOwnerEmail: parsed.email };
      if(parsed.port!==undefined) startArgs.port=parsed.port;
      api=await startOwnerMeetServer(startArgs);
      if(!stopping) console.log(api.url);
    }catch{ process.exitCode=1; }
  })();
  bootPromise.catch(()=>{ process.exitCode=1; });
  const handler=(): void => {
    stopping=true;
    const p=(async()=>{
      try{ await bootPromise; }catch{}
      if(api!==undefined){ try{ await api.stop(); process.exitCode=0; }catch{ process.exitCode=1; } }
      else { if(process.exitCode!==1) process.exitCode=1; }
    })();
    p.catch(()=>{ process.exitCode=1; });
  };
  process.on("SIGINT",handler);
  process.on("SIGTERM",handler);
}
