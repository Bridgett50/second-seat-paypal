import { createOwnerDraftExport } from "./ownerDraftExport.js";
import type { MeetingRoomService } from "./meetingRoom.js";
import type { createGoogleConnections } from "./googleConnections.js";
import type { createGoogleWriteOutbox } from "./googleWriteOutbox.js";
import type { MeetWorkerRequest } from "./meetWorkerHttp.js";
type Opts={origin:string;service:MeetingRoomService;connections:ReturnType<typeof createGoogleConnections>;outbox:ReturnType<typeof createGoogleWriteOutbox>;fetcher:typeof fetch;now?:()=>number};
function isPlain(o:unknown):o is Record<string,unknown>{if(typeof o!=="object"||o===null||Array.isArray(o))return false;const p=Object.getPrototypeOf(o);return p===Object.prototype||p===null;}
function noAccessors(o:Record<string,unknown>){for(const k of Reflect.ownKeys(o)){if(typeof k==="symbol")return false;const d=Object.getOwnPropertyDescriptor(o,k);if(!d||!d.enumerable||!("value" in d))return false;}return true;}
function badStr(s:unknown,max:number):boolean{if(typeof s!=="string")return true;if(s.length>max)return true;if(s.trim().length===0)return true;return /[\x00-\x1F\x7F]/.test(s);}
function hex64(s:unknown){return typeof s==="string"&&/^[0-9a-f]{64}$/.test(s);}
const ALLOWED_REMOTE=new Set(["127.0.0.1","::1","::ffff:127.0.0.1"]);
const ROUTES=new Set(["/api/google/draft/preview","/api/google/draft/approve","/api/google/draft/create","/api/google/draft/invalidate"]);
export function createOwnerDraftHttp(opts:Opts){
let u:URL;try{u=new URL(opts.origin);}catch{throw new Error("configuration error");}
if(u.username||u.password||u.pathname!=="/"||u.search||u.hash||opts.origin.endsWith("/")||opts.origin!==u.origin||u.protocol!=="http:"||!["localhost","127.0.0.1","::1","[::1]"].includes(u.hostname))throw new Error("configuration error");
const cfg={origin:opts.origin,host:u.host};
const exporter=createOwnerDraftExport({readCurrent:(k,r)=>opts.service.approvedGoogleDraftAs(k,r),getToken:(k:string)=>opts.connections.getAccessToken(k,"gmail-draft"),outbox:opts.outbox,fetcher:opts.fetcher,...(opts.now!==undefined?{now:opts.now}:{})});
const base:Record<string,string>={"Cache-Control":"no-store","Referrer-Policy":"no-referrer","Content-Type":"application/json;charset=utf-8"};
return async (req:MeetWorkerRequest):Promise<{status:number;headers:Record<string,string>;body:unknown}>=>{
const h=(extra?:Record<string,string>):Record<string,string>=>({...base,...extra});
try{
if(!req.remoteAddress||!ALLOWED_REMOTE.has(req.remoteAddress)||req.host!==cfg.host)return {status:403,headers:h(),body:{error:"Forbidden"}};
if(!ROUTES.has(req.path))return {status:404,headers:h(),body:{error:"Not found"}};
if(req.method!=="POST")return {status:405,headers:h({Allow:"POST"}),body:{error:"Method not allowed"}};
if(req.origin!==cfg.origin)return {status:403,headers:h(),body:{error:"Forbidden"}};
if(req.query.size!==0)return {status:400,headers:h(),body:{error:"Invalid query"}};
const ck=req.callerKey;if(ck===null||badStr(ck,1024))return {status:401,headers:h(),body:{error:"Unauthorized"}};
const caller=ck;
const b=req.body;if(!isPlain(b)||!noAccessors(b))return {status:400,headers:h(),body:{error:"Invalid body"}};
let roomId:string="";let mode:"preview"|"approve"|"create"|"invalidate"="preview";
if(req.path==="/api/google/draft/preview")mode="preview";else if(req.path==="/api/google/draft/approve")mode="approve";else if(req.path==="/api/google/draft/create")mode="create";else mode="invalidate";
let toV:unknown;let subjV:unknown;let hashV:unknown;
if(mode==="preview"){
const ks=Object.keys(b);if(ks.length!==3||!("roomId" in b&&"to" in b&&"subject" in b))return {status:400,headers:h(),body:{error:"Invalid body"}};
roomId=b["roomId"] as string;toV=b["to"];subjV=b["subject"];
if(badStr(roomId,256))return {status:400,headers:h(),body:{error:"Invalid roomId"}};
if(badStr(toV,320))return {status:400,headers:h(),body:{error:"Invalid to"}};
if(badStr(subjV,200))return {status:400,headers:h(),body:{error:"Invalid subject"}};
}else if(mode==="approve"||mode==="create"){
const ks=Object.keys(b);if(ks.length!==2||!("roomId" in b&&"packageHash" in b))return {status:400,headers:h(),body:{error:"Invalid body"}};
roomId=b["roomId"] as string;hashV=b["packageHash"];
if(badStr(roomId,256))return {status:400,headers:h(),body:{error:"Invalid roomId"}};
if(!hex64(hashV))return {status:400,headers:h(),body:{error:"Invalid packageHash"}};
}else{
const ks=Object.keys(b);if(ks.length!==1||!("roomId" in b))return {status:400,headers:h(),body:{error:"Invalid body"}};
roomId=b["roomId"] as string;if(badStr(roomId,256))return {status:400,headers:h(),body:{error:"Invalid roomId"}};
}
const owned=await opts.service.actAs(caller,{roomId,action:"state"},{host:cfg.host});
const snap=owned.body.snapshot;
if(owned.status!==200||!snap||snap.roomId!==roomId)return {status:404,headers:h(),body:{error:"Not found"}};
if(mode==="invalidate"){exporter.invalidate(caller,roomId);return {status:200,headers:h(),body:{status:"invalidated"}};}
if(mode==="preview"){
const r=exporter.preview(caller,roomId,String(toV),String(subjV));
if(r.status==="denied")return {status:409,headers:h(),body:r};
return {status:200,headers:h(),body:r};
}
if(mode==="approve"){
const r=exporter.approve(caller,roomId,String(hashV));
if(r.status==="denied")return {status:409,headers:h(),body:r};
return {status:200,headers:h(),body:r};
}
const controller=new AbortController();const t=setTimeout(()=>controller.abort(),30000);t.unref();
try{
const r=await exporter.create(caller,roomId,String(hashV),controller.signal);
if(r.status==="created")return {status:200,headers:h(),body:r};
if(r.status==="unconfirmed")return {status:202,headers:h(),body:r};
if(r.status==="denied")return {status:409,headers:h(),body:r};
return {status:503,headers:h(),body:{error:"Draft export unavailable"}};
}catch{return {status:503,headers:h(),body:{error:"Draft export unavailable"}};}finally{clearTimeout(t);}
}catch{return {status:503,headers:h(),body:{error:"Draft export unavailable"}};}
};
}
