import type { MeetingRoomService } from "./meetingRoom.js";
import { createMeetWorkerPairing, type MeetWorkerBinding } from "./meetWorkerPairing.js";
export type MeetWorkerCapture=Readonly<{sample:()=>Promise<readonly Readonly<{event:Readonly<{version:1;meetingId:string;utteranceId:string;sequence:number;revision:number;speaker:string;text:string}>;verified:false}>[]>;stop:()=>Promise<void>}>;
export type Capture=MeetWorkerCapture;
type Reply=Readonly<{status:number;body:Readonly<{status:"idle"|"starting"|"listening"|"stopping"|"stopped"|"failed"|"stop-unconfirmed";accepted:number}>}>;
function freezeReply(s:number,b:Reply["body"]["status"],a:number):Reply{return Object.freeze({status:s,body:Object.freeze({status:b,accepted:a})})}
type BridgeDeps={service:MeetingRoomService;startCapture:(scope:{meetingUrl:string;displayName:string;binding:MeetWorkerBinding;isCurrent:()=>boolean},signal:AbortSignal)=>Promise<Capture>;now?:()=>number};
type Lease=ReturnType<ReturnType<typeof createMeetWorkerPairing>["consume"]>&{};
type Rec={callerKey:string;roomId:string;scopeKey:string;binding:MeetWorkerBinding;lease:Lease;controller:AbortController;state:Reply["body"]["status"];accepted:number;stopRequested:boolean;capture:Capture|null;launch:Promise<void>;cleanupP:Promise<Reply>|null;sampling:boolean;launchUnconfirmed:boolean};
export function createMeetWorkerBridge(deps:BridgeDeps){
const{service,startCapture}=deps;
const pairing=createMeetWorkerPairing({readBinding:(c,r)=>service.workerBindingAs(c,r),...(deps.now!==undefined?{now:deps.now}:{})});
const records=new Map<string,Rec>();
const MAX=128;
const sk=(c:string,r:string)=>`${c.length}:${c}\u0000${r.length}:${r}`;
const isStr=(v:unknown):v is string=>typeof v==="string"&&v.trim().length>0;
const isActive=(s:Rec["state"]):boolean=>s==="starting"||s==="listening"||s==="stopping"||s==="stop-unconfirmed";
const isTerm=(s:Rec["state"]):boolean=>s==="stopped"||s==="failed";
function beginStop(rec:Rec):Promise<Reply>{
rec.stopRequested=true;
try{rec.lease.revoke()}catch{}
try{rec.controller.abort()}catch{}
if(rec.cleanupP!==null)return rec.cleanupP;
if(rec.state!=="stop-unconfirmed")rec.state="stopping";
const p=(async():Promise<Reply>=>{
try{await rec.launch}catch{}
if(rec.capture!==null){try{await rec.capture.stop();rec.state="stopped"}catch{rec.state="stop-unconfirmed"}}
else if(rec.launchUnconfirmed){rec.state="stop-unconfirmed"}
else{rec.state="stopped"}
return freezeReply(200,rec.state,rec.accepted)})();
rec.cleanupP=p;
return p}
function tryEvict():boolean{
if(records.size<MAX)return true;
for(const[k,r]of records)if(isTerm(r.state)){records.delete(k);return true}
return false}
function getRec(callerKey:string|null,roomId:unknown):Rec|null{
if(!isStr(callerKey)||!isStr(roomId))return null;
return records.get(sk(callerKey,roomId as string))??null}
const api={
connect(callerKey:string|null,roomId:unknown,meetingUrl:unknown,displayName:unknown):Reply{
if(!isStr(callerKey)||!isStr(roomId))return freezeReply(404,"stopped",0);
const k=sk(callerKey,roomId as string);
const ex=records.get(k);
if(ex!==undefined){if(isActive(ex.state))return freezeReply(409,ex.state,ex.accepted);if(!isTerm(ex.state))return freezeReply(409,ex.state,ex.accepted)}
const b=service.workerBindingAs(callerKey,roomId as string);
if(b===null)return freezeReply(404,"stopped",0);
const approved=pairing.approve(callerKey,roomId as string,meetingUrl,displayName);
if(approved===null)return freezeReply(404,"stopped",0);
const lease=pairing.consume(approved.token);
if(lease===null)return freezeReply(404,"stopped",0);
if(!tryEvict()){try{lease.revoke()}catch{};return freezeReply(409,"stopped",0)}
const controller=new AbortController();
const rec:Rec={callerKey,roomId:roomId as string,scopeKey:k,binding:lease.binding,lease:lease as Lease,controller,state:"starting",accepted:0,stopRequested:false,capture:null,launch:Promise.resolve(),cleanupP:null,sampling:false,launchUnconfirmed:false};
records.set(k,rec);
rec.launch=Promise.resolve().then(async()=>{
if(!lease.isCurrent()||controller.signal.aborted){rec.state="stopped";return}
let cap:Capture;
try{cap=await startCapture({meetingUrl:lease.meetingUrl,displayName:lease.displayName,binding:lease.binding,isCurrent:lease.isCurrent},controller.signal)}catch(e){
let confirmed=false;let unk=false;
try{const v=(e as Record<string,unknown>)["cleanupConfirmed"];if(v===true)confirmed=true;else if(v===false)unk=true;else unk=true}catch{unk=true}
if(unk)rec.launchUnconfirmed=true;
if(confirmed){rec.state=rec.stopRequested?"stopped":"failed"}else if(unk){rec.state="stop-unconfirmed"}
try{lease.revoke()}catch{};try{controller.abort()}catch{};return}
if(!lease.isCurrent()||controller.signal.aborted){rec.capture=cap;void beginStop(rec);return}
rec.capture=cap;
if(records.get(k)===rec)rec.state="listening"});
return freezeReply(202,"starting",0)},
status(callerKey:string|null,roomId:unknown):Reply{
if(!isStr(callerKey)||!isStr(roomId))return freezeReply(404,"stopped",0);
const rec=records.get(sk(callerKey,roomId as string));
if(rec!==undefined){
if((rec.state==="starting"||rec.state==="listening")&&!rec.lease.isCurrent()){void beginStop(rec);return freezeReply(200,"stopping",rec.accepted)}
return freezeReply(200,rec.state,rec.accepted)}
const bb=service.workerBindingAs(callerKey,roomId as string);
if(bb!==null)return freezeReply(200,"idle",0);
return freezeReply(404,"stopped",0)},
async sample(callerKey:string|null,roomId:unknown):Promise<Reply>{
if(!isStr(callerKey)||!isStr(roomId))return freezeReply(404,"stopped",0);
const rec=getRec(callerKey,roomId);
if(rec===null)return freezeReply(404,"stopped",0);
if(rec.lease.isCurrent()===false||rec.controller.signal.aborted){void beginStop(rec);return freezeReply(200,rec.state,rec.accepted)}
if(rec.state!=="listening")return freezeReply(404,"stopped",0);
if(rec.sampling)return freezeReply(409,rec.state,rec.accepted);
rec.sampling=true;
try{
let batch:readonly unknown[];
try{if(rec.capture===null)throw new Error("no capture");batch=await rec.capture.sample() as readonly unknown[]}catch{console.warn("[meet-step] failed: bridge.sample");void beginStop(rec);return freezeReply(200,"stopping",rec.accepted)}
if(!rec.lease.isCurrent()||rec.controller.signal.aborted){void beginStop(rec);return freezeReply(200,rec.state,rec.accepted)}
for(const item of batch){
if(!rec.lease.isCurrent()||rec.controller.signal.aborted){void beginStop(rec);break}
let ev:unknown;let ver:unknown;
try{ev=(item as Record<string,unknown>)["event"];ver=(item as Record<string,unknown>)["verified"]}catch{void beginStop(rec);break}
if(ver!==false){console.warn("[meet-step] failed: bridge.verified");void beginStop(rec);break}
try{const mid=(ev as Record<string,unknown>)["meetingId"];if(mid!==rec.binding.meetingId)throw new Error("foreign")}catch{console.warn("[meet-step] failed: bridge.meetingId");void beginStop(rec);break}
if(!rec.lease.isCurrent()||rec.controller.signal.aborted){void beginStop(rec);break}
let res:ReturnType<MeetingRoomService["ingestConversationAs"]>;
try{res=service.ingestConversationAs(callerKey as string,roomId as string,ev as unknown)}catch{console.warn("[meet-step] failed: bridge.ingest");void beginStop(rec);break}
if(res.status===409)continue;
if(res.status!==200){console.warn("[meet-step] failed: bridge.ingest "+String(res.status));void beginStop(rec);break}
rec.accepted++}
return freezeReply(200,rec.state,rec.accepted)}catch{void beginStop(rec);return freezeReply(200,rec.state,rec.accepted)}finally{rec.sampling=false}},
async stop(callerKey:string|null,roomId:unknown):Promise<Reply>{
if(!isStr(callerKey)||!isStr(roomId))return freezeReply(404,"stopped",0);
const rec=getRec(callerKey,roomId);
if(rec===null){const bb=service.workerBindingAs(callerKey as string,roomId as string);if(bb!==null)return freezeReply(200,"idle",0);return freezeReply(404,"stopped",0)}
return beginStop(rec)},
revoke(callerKey:string|null,roomId:unknown):Reply{
if(!isStr(callerKey)||!isStr(roomId))return freezeReply(404,"stopped",0);
const rec=getRec(callerKey,roomId);
if(rec===null)return freezeReply(404,"stopped",0);
void beginStop(rec);return freezeReply(200,rec.state,rec.accepted)} };
return Object.freeze(api)}
