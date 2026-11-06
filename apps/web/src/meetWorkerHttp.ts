import type { MeetingRoomService } from "./meetingRoom.js";
import type { createMeetWorkerBridge } from "./meetWorkerBridge.js";
import { renderMeetingRoomBody } from "./meetingRoomRender.js";
import type { MeetingRoomSnapshot } from "./meetingRoom.js";
type Bridge = ReturnType<typeof createMeetWorkerBridge>;
type Req = { method:string; path:string; callerKey:string|null; origin:string|null; host:string|null; remoteAddress:string|null; body:unknown; query:URLSearchParams };
export type MeetWorkerRequest = Req;
const H: Record<string,string> = { "content-type":"application/json; charset=utf-8", "cache-control":"no-store", "referrer-policy":"no-referrer" };
function bad():never{ throw new Error("invalid config"); }
function parseOrigin(o:string):URL{
 if(o!==o.trim()||!o) bad();
 if(o.endsWith("/")||o.includes("?")||o.includes("#")||o.includes("@")) bad();
 let u:URL; try{ u=new URL(o);}catch{ bad(); }
 if(u.protocol!=="http:") bad();
 if(u.pathname!=="/"||u.search||u.hash||u.username||u.password) bad();
 const h=u.hostname; if(h!=="localhost"&&h!=="127.0.0.1"&&h!=="::1"&&h!=="[::1]") bad();
 if(o!==u.origin) bad(); return u;
}
export function createMeetWorkerHttp(opts:{ origin:string; service:MeetingRoomService; bridge:Bridge; canPrepare:()=>boolean }){
 const cfg=parseOrigin(opts.origin); const cfgHost=cfg.host; const cfgOrigin=cfg.origin;
 const service=opts.service; const bridge=opts.bridge; const canPrepareFn=opts.canPrepare;
 const postSet=new Set(["/api/meeting-room/worker/connect","/api/meeting-room/worker/stop","/api/meeting-room/worker/correct","/api/meeting-room/worker/prepare"]);
 const allSet=new Set([...postSet,"/api/meeting-room/worker/status"]);
 const isLocal=(ip:string|null)=>ip==="127.0.0.1"||ip==="::1"||ip==="::ffff:127.0.0.1";
 const isPlain=(v:unknown)=>typeof v==="object"&&v!==null&&Object.getPrototypeOf(v)===Object.prototype&&Object.getOwnPropertySymbols(v as object).length===0;
 const nonBlank=(v:unknown)=>typeof v==="string"&&v.trim()&&v.length<=200;
 const exactFields=(o:object,ks:string[])=>{ const k=Object.keys(o); return k.length===ks.length&&ks.every(x=>Object.prototype.hasOwnProperty.call(o,x)); };
 return async function handle(req:Req):Promise<{status:number;headers:Record<string,string>;body:unknown}>{
  const reply=(s:number,b:unknown)=>({status:s,headers:{...H},body:b});
  try{
   if(!isLocal(req.remoteAddress)||req.host!==cfgHost) return reply(403,{error:"forbidden"});
   if(req.callerKey===null||req.callerKey.trim()==="") return reply(401,{error:"unauthorized"});
   if(!allSet.has(req.path)) return reply(404,{error:"not found"});
   const isPost=postSet.has(req.path);
   if(req.method!== (isPost?"POST":"GET")) return {status:405,headers:{...H,allow:isPost?"POST":"GET"},body:{error:"method not allowed"}};
   if(req.method==="POST"){ if(req.origin!==cfgOrigin) return reply(403,{error:"forbidden"}); if(req.query.size!==0) return reply(400,{error:"bad request"}); } else { if(req.origin!==null&&req.origin!==cfgOrigin) return reply(403,{error:"forbidden"}); }
   let roomId="";
   if(req.path==="/api/meeting-room/worker/status"){
    if(req.query.size!==1||req.query.getAll("roomId").length!==1) return reply(400,{error:"bad request"});
    roomId=req.query.get("roomId")!; if(!nonBlank(roomId)) return reply(400,{error:"bad request"});
   } else {
    if(!isPlain(req.body)) return reply(400,{error:"bad request"});
    const b=req.body as Record<string,unknown>;
    if(req.path==="/api/meeting-room/worker/connect"){ if(!exactFields(b,["roomId","meetingUrl","displayName"])) return reply(400,{error:"bad request"}); if(!nonBlank(b.roomId)) return reply(400,{error:"bad request"}); if(typeof b.meetingUrl!=="string"||!b.meetingUrl.trim()) return reply(400,{error:"bad request"}); if(typeof b.displayName!=="string"||!b.displayName.trim()) return reply(400,{error:"bad request"}); roomId=b.roomId as string; }
    else if(req.path==="/api/meeting-room/worker/stop"){ if(!exactFields(b,["roomId"])) return reply(400,{error:"bad request"}); if(!nonBlank(b.roomId)) return reply(400,{error:"bad request"}); roomId=b.roomId as string; }
    else if(req.path==="/api/meeting-room/worker/correct"){ if(!exactFields(b,["roomId","utteranceId","expectedRevision","text"])) return reply(400,{error:"bad request"}); if(!nonBlank(b.roomId)) return reply(400,{error:"bad request"}); if(typeof b.utteranceId!=="string"||!b.utteranceId.trim()) return reply(400,{error:"bad request"}); if(typeof b.expectedRevision!=="number"||!Number.isSafeInteger(b.expectedRevision)||(b.expectedRevision as number)<1) return reply(400,{error:"bad request"}); if(typeof b.text!=="string") return reply(400,{error:"bad request"}); roomId=b.roomId as string; }
    else if(req.path==="/api/meeting-room/worker/prepare"){ if(!exactFields(b,["roomId"])) return reply(400,{error:"bad request"}); if(!nonBlank(b.roomId)) return reply(400,{error:"bad request"}); roomId=b.roomId as string; }
   }
   const pre=await service.actAs(req.callerKey,{roomId,action:"state"},{host:cfgHost});
   if(pre.status!==200) return reply(pre.status,{error:"not found"});
   const preSnap=pre.body.snapshot; if(!preSnap||preSnap.roomId!==roomId) return reply(404,{error:"not found"});
   const cur=bridge.status(req.callerKey,roomId);
   let actionStatus=cur.status; let actionBody: unknown = cur.body;
   const stoppedPhase=(cur.status===200&&(cur.body as {status:string}).status==="stopped");
   if(req.path==="/api/meeting-room/worker/connect"){ const b=req.body as Record<string,unknown>; const r=bridge.connect(req.callerKey,roomId,b.meetingUrl as string,b.displayName as string); actionStatus=r.status; actionBody=r.body; }
   else if(req.path==="/api/meeting-room/worker/stop"){ const r=await bridge.stop(req.callerKey,roomId); actionStatus=r.status; actionBody=r.body; }
   else if(req.path==="/api/meeting-room/worker/correct"){
    if(cur.status===404) return reply(404,{error:"not found"});
    if(cur.status!==200) return reply(cur.status,{error:"not found"});
    if(!stoppedPhase) return reply(409,{error:"conflict"});
    const b=req.body as Record<string,unknown>; const r=service.correctConversationAs(req.callerKey,b.roomId,b.utteranceId,b.expectedRevision,b.text); actionStatus=r.status; actionBody=r.body;
   } else if(req.path==="/api/meeting-room/worker/prepare"){
    if(cur.status===404) return reply(404,{error:"not found"});
    if(cur.status!==200) return reply(cur.status,{error:"not found"});
    if(!stoppedPhase) return reply(409,{error:"conflict"});
    let ok=false; try{ ok=canPrepareFn()===true;}catch{ ok=false; } if(!ok) return reply(403,{error:"forbidden"});
    if(preSnap.view.twinStatus!=="active"||preSnap.view.draft.sendState!=="unsent") return reply(409,{error:"conflict"});
    const r=service.finishConversationAs(req.callerKey,roomId); actionStatus=r.status; actionBody=r.body;
   }
   const post=await service.actAs(req.callerKey,{roomId,action:"state"},{host:cfgHost});
   if(post.status===404||!post.body.snapshot||post.body.snapshot.roomId!==roomId) return reply(404,{error:"not found"});
   if(post.status!==200) return reply(post.status,{error:"not found"});
   const fresh=bridge.status(req.callerKey,roomId);
   const snap: MeetingRoomSnapshot = post.body.snapshot;
   if(fresh.status===404){
    if(req.path==="/api/meeting-room/worker/status"&&snap.view.twinStatus!=="active") return reply(200,{status:"idle",phase:"idle",accepted:0,canPrepare:false,snapshot:snap,html:renderMeetingRoomBody(snap),announcements:post.body.announcements});
    return reply(404,{error:"not found"});
   }
   if(actionStatus===404) return reply(404,{error:"not found"});
   let canPrepare=false; try{ const phase=(fresh.body as {status:string}).status; canPrepare=phase==="stopped"&&canPrepareFn()===true&&snap.view.twinStatus==="active"&&snap.view.draft.sendState==="unsent"; }catch{ canPrepare=false; }
   const freshStatusStr=(fresh.body as {status:string}).status;
   const httpStatus=req.path==="/api/meeting-room/worker/status" ? fresh.status : actionStatus;
   if(req.path==="/api/meeting-room/worker/status") return reply(httpStatus,{status:freshStatusStr,phase:freshStatusStr,accepted:(fresh.body as {accepted:number}).accepted,canPrepare,snapshot:snap,html:renderMeetingRoomBody(snap),announcements:post.body.announcements});
   return reply(actionStatus,{status:freshStatusStr,phase:freshStatusStr,accepted:(fresh.body as {accepted:number}).accepted,canPrepare,snapshot:snap,html:renderMeetingRoomBody(snap),announcements:post.body.announcements});
  }catch{ return reply(503,{error:"unavailable"}); }
 };
}
