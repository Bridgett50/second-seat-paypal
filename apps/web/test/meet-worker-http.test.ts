import { describe, it, expect, vi, beforeEach, type MockInstance } from "vitest";
import { createMeetingRoomService, type MeetingRoomSnapshot } from "../src/meetingRoom.js";
import { createMeetWorkerBridge, type Capture } from "../src/meetWorkerBridge.js";
import { createMeetWorkerHttp, type MeetWorkerRequest } from "../src/meetWorkerHttp.js";
function deferred<T>(){let res:(v:T)=>void,rej:(e:unknown)=>void;const p=new Promise<T>((a,b)=>{res=a;rej=b});return{promise:p,resolve:res!,reject:rej!}};
function mkReq(o:Partial<MeetWorkerRequest> & {path:string;method:string}):MeetWorkerRequest{return{method:o.method,path:o.path,callerKey:o.callerKey??null,origin:o.origin??null,host:o.host??"127.0.0.1:4174",remoteAddress:o.remoteAddress??"127.0.0.1",body:o.body??null,query:o.query??new URLSearchParams()}};
function body(v:unknown){return v as Record<string,unknown>}
const ORIGIN="http://127.0.0.1:4174";
const HOST="127.0.0.1:4174";
const KEY="owner-browser";
describe("meet-worker-http",()=>{
  let service:ReturnType<typeof createMeetingRoomService>;
  let bridge:ReturnType<typeof createMeetWorkerBridge>;
  let http:ReturnType<typeof createMeetWorkerHttp>;
  let modelCalls:number;let launches:number;
  let captureDeferred:ReturnType<typeof deferred<Capture>>;
  let entered:ReturnType<typeof deferred<{meetingUrl:string;displayName:string}>>;
  let closeEntered:ReturnType<typeof deferred<void>>;
  let closeACK:ReturnType<typeof deferred<void>>;
  let fakeCapture:Capture;
  let finishSpy:MockInstance<ReturnType<typeof createMeetingRoomService>["finishConversationAs"]>;
  let correctSpy:MockInstance<ReturnType<typeof createMeetingRoomService>["correctConversationAs"]>;
  beforeEach(()=>{
    modelCalls=0;launches=0;
    captureDeferred=deferred<Capture>();entered=deferred();closeEntered=deferred();closeACK=deferred();
    service=createMeetingRoomService({env:{SECOND_SEAT_TEST_MODE:"1"},conversationInput:true,candidateAutoDispatch:false,sessionPolicy:true,now:()=>1000,candidateReasoner:async()=>{modelCalls++;return null;}});
    const opened=service.open("",{host:HOST},KEY);
    void opened;
    bridge=createMeetWorkerBridge({service,now:()=>1000,startCapture(scope,_signal){launches++;entered.resolve({meetingUrl:scope.meetingUrl,displayName:scope.displayName});return captureDeferred.promise;}});
    http=createMeetWorkerHttp({origin:ORIGIN,service,bridge,canPrepare:()=>false});
    finishSpy=vi.spyOn(service,"finishConversationAs");
    correctSpy=vi.spyOn(service,"correctConversationAs");
  });
  it("rejects foreign cookie and bad network/origin/host/remote/missing cookie before side effects",async()=>{
    const room=service.open("",{host:HOST},KEY).roomId;
    const base={method:"POST",path:"/api/meeting-room/worker/connect",callerKey:KEY,origin:ORIGIN,host:HOST,remoteAddress:"127.0.0.1",body:{roomId:room,meetingUrl:"https://meet.google.com/abc-defg-hij",displayName:"Second Seat AI twin (test)"},query:new URLSearchParams()} as const;
    const cases:MeetWorkerRequest[]=[
      mkReq({...base,callerKey:"foreign",origin:ORIGIN}),
      mkReq({...base,origin:"http://evil.com"}),
      mkReq({...base,origin:null}),
      mkReq({...base,host:"evil.com"}),
      mkReq({...base,remoteAddress:"10.0.0.1"}),
      mkReq({...base,callerKey:null,origin:ORIGIN}),
      mkReq({method:"POST",path:"/api/meeting-room/worker/correct",callerKey:KEY,origin:"http://evil.com",host:HOST,remoteAddress:"127.0.0.1",body:{roomId:room,utteranceId:"u1",expectedRevision:1,text:"hi"},query:new URLSearchParams()}),
      mkReq({method:"POST",path:"/api/meeting-room/worker/prepare",callerKey:KEY,origin:null,host:HOST,remoteAddress:"127.0.0.1",body:{roomId:room},query:new URLSearchParams()}),
    ];
    for(const r of cases){const res=await http(r);expect(res.status).toBe([404,403,403,403,403,401,403,403][cases.indexOf(r)]);expect(res.headers["access-control-allow-origin"]).toBeUndefined();expect(res.headers["content-type"]).toMatch(/json/);expect(res.headers["cache-control"]).toBe("no-store");expect(res.headers["referrer-policy"]).toBe("no-referrer");}
    expect(launches).toBe(0);expect(correctSpy).toHaveBeenCalledTimes(0);expect(finishSpy).toHaveBeenCalledTimes(0);expect(modelCalls).toBe(0);
  });
  it("strict JSON 400, wrong method 405, unknown path 404 without effects",async()=>{
    const room=service.open("",{host:HOST},KEY).roomId;
    const r400a=await http(mkReq({method:"POST",path:"/api/meeting-room/worker/connect",callerKey:KEY,origin:ORIGIN,host:HOST,remoteAddress:"127.0.0.1",body:{roomId:room,meetingUrl:"https://meet.google.com/abc-defg-hij",displayName:"Second Seat AI twin (test)",ownerId:"extra"},query:new URLSearchParams()}));
    const r400b=await http(mkReq({method:"POST",path:"/api/meeting-room/worker/stop",callerKey:KEY,origin:ORIGIN,host:HOST,remoteAddress:"127.0.0.1",body:{roomId:[room]},query:new URLSearchParams()}));
    const r400c=await http(mkReq({method:"POST",path:"/api/meeting-room/worker/correct",callerKey:KEY,origin:ORIGIN,host:HOST,remoteAddress:"127.0.0.1",body:{roomId:room,utteranceId:"u1",expectedRevision:1,text:null},query:new URLSearchParams()}));
    const r400d=await http(mkReq({method:"POST",path:"/api/meeting-room/worker/connect",callerKey:KEY,origin:ORIGIN,host:HOST,remoteAddress:"127.0.0.1",body:{roomId:room,meetingUrl:"https://meet.google.com/abc-defg-hij",displayName:"Second Seat AI twin (test)"},query:new URLSearchParams("foo=1")}));
    const r405=await http(mkReq({method:"GET",path:"/api/meeting-room/worker/connect",callerKey:KEY,origin:ORIGIN,host:HOST,remoteAddress:"127.0.0.1",body:null,query:new URLSearchParams()}));
    const r404=await http(mkReq({method:"GET",path:"/api/meeting-room/worker/unknown",callerKey:KEY,origin:ORIGIN,host:HOST,remoteAddress:"127.0.0.1",body:null,query:new URLSearchParams()}));
    for(const r of[r400a,r400b,r400c,r400d])expect(r.status).toBe(400);
    expect(r405.status).toBe(405);expect(r405.headers.allow==="POST").toBe(true);expect(r404.status).toBe(404);
    expect(launches).toBe(0);expect(finishSpy).toHaveBeenCalledTimes(0);expect(correctSpy).toHaveBeenCalledTimes(0);
  });
  it("GET status owned absent origin 200 idle with snapshot/html, foreign 404 no private keys, invalid origin 403, dup query 400",async()=>{
    const room=service.open("",{host:HOST},KEY).roomId;
    const ok=await http(mkReq({method:"GET",path:"/api/meeting-room/worker/status",callerKey:KEY,origin:null,host:HOST,remoteAddress:"127.0.0.1",body:null,query:new URLSearchParams({roomId:room})}));
    expect(ok.status).toBe(200);const b=body(ok.body);expect(b["status"]).toBe("idle");expect(b["phase"]).toBe(b["status"]);expect(typeof b["accepted"]).toBe("number");expect(b["canPrepare"]).toBe(false);expect(b["snapshot"]).toBeTruthy();expect(typeof b["html"]).toBe("string");expect((b["snapshot"] as {roomId:string}).roomId).toBe(room);expect(b["snapshot"]).toBeTruthy();
    const foreign=await http(mkReq({method:"GET",path:"/api/meeting-room/worker/status",callerKey:"other",origin:null,host:HOST,remoteAddress:"127.0.0.1",body:null,query:new URLSearchParams({roomId:room})}));
    expect(foreign.status).toBe(404);expect(JSON.stringify(foreign.body)).not.toContain(KEY);expect(body(foreign.body)["snapshot"]).toBeUndefined();
    const badOrigin=await http(mkReq({method:"GET",path:"/api/meeting-room/worker/status",callerKey:KEY,origin:"http://evil.com",host:HOST,remoteAddress:"127.0.0.1",body:null,query:new URLSearchParams({roomId:room})}));
    expect(badOrigin.status).toBe(403);
    const dup=await http(mkReq({method:"GET",path:"/api/meeting-room/worker/status",callerKey:KEY,origin:null,host:HOST,remoteAddress:"127.0.0.1",body:null,query:(()=>{const q=new URLSearchParams();q.append("roomId",room);q.append("roomId",room);return q})()}));
    expect(dup.status).toBe(400);
  });
  it("happy flow connect 202, correct 409 while listening, stop awaits ACK, correct and prepare semantics",async()=>{
    const room=service.open("",{host:HOST},KEY).roomId;
    const binding=service.workerBindingAs(KEY,room)!;
    fakeCapture={sample:async()=>[{event:{version:1,meetingId:binding.meetingId,utteranceId:"u1",sequence:1,revision:1,speaker:"a",text:"old"},verified:false} as const],stop:async()=>{closeEntered.resolve();await closeACK.promise}};
    captureDeferred.resolve(fakeCapture);
    const connectP=http(mkReq({method:"POST",path:"/api/meeting-room/worker/connect",callerKey:KEY,origin:ORIGIN,host:HOST,remoteAddress:"127.0.0.1",body:{roomId:room,meetingUrl:"https://meet.google.com/abc-defg-hij",displayName:"Second Seat AI twin (test)"},query:new URLSearchParams()}));
    await entered.promise;
    const connectRes=await connectP;
    expect(connectRes.status).toBe(202);expect(["starting","listening"]).toContain(body(connectRes.body)["status"] as string);
    await Promise.resolve();
    const sampled=await bridge.sample(KEY,room);expect(sampled.body.accepted).toBe(1);
    const whileListening=await http(mkReq({method:"POST",path:"/api/meeting-room/worker/correct",callerKey:KEY,origin:ORIGIN,host:HOST,remoteAddress:"127.0.0.1",body:{roomId:room,utteranceId:"u1",expectedRevision:1,text:"x"},query:new URLSearchParams()}));
    expect(whileListening.status).toBe(409);expect(correctSpy).toHaveBeenCalledTimes(0);
    const stopP=http(mkReq({method:"POST",path:"/api/meeting-room/worker/stop",callerKey:KEY,origin:ORIGIN,host:HOST,remoteAddress:"127.0.0.1",body:{roomId:room},query:new URLSearchParams()}));
    await closeEntered.promise;
    expect(bridge.status(KEY,room).body.status).toBe("stopping");
    let settled=false;void stopP.then(()=>{settled=true});
    await Promise.resolve();expect(settled).toBe(false);
    closeACK.resolve();
    const stopRes=await stopP;expect(stopRes.status).toBe(200);expect(body(stopRes.body)["status"]).toBe("stopped");
    const correctOk=await http(mkReq({method:"POST",path:"/api/meeting-room/worker/correct",callerKey:KEY,origin:ORIGIN,host:HOST,remoteAddress:"127.0.0.1",body:{roomId:room,utteranceId:"u1",expectedRevision:1,text:"corrected"},query:new URLSearchParams()}));
    expect(correctOk.status).toBe(200);expect(correctSpy).toHaveBeenCalledTimes(1);const snap=(body(correctOk.body)["snapshot"] as MeetingRoomSnapshot);
    expect(snap.conversation?.utterances.find(u=>u.utteranceId==="u1")?.text).toBe("corrected");expect(snap.conversation?.utterances.find(u=>u.utteranceId==="u1")?.revision).toBe(2);
    const stale=await http(mkReq({method:"POST",path:"/api/meeting-room/worker/correct",callerKey:KEY,origin:ORIGIN,host:HOST,remoteAddress:"127.0.0.1",body:{roomId:room,utteranceId:"u1",expectedRevision:1,text:"again"},query:new URLSearchParams()}));
    expect(stale.status).toBe(409);
    const prep=await http(mkReq({method:"POST",path:"/api/meeting-room/worker/prepare",callerKey:KEY,origin:ORIGIN,host:HOST,remoteAddress:"127.0.0.1",body:{roomId:room},query:new URLSearchParams()}));
    expect(prep.status).toBe(403);expect(finishSpy).toHaveBeenCalledTimes(0);expect(modelCalls).toBe(0);
  });
  it("owned takeover paused GET idle not stopped",async()=>{
    const room=service.open("",{host:HOST},KEY).roomId;
    await service.actAs(KEY,{roomId:room,action:"takeover"},{host:HOST});
    const res=await http(mkReq({method:"GET",path:"/api/meeting-room/worker/status",callerKey:KEY,origin:null,host:HOST,remoteAddress:"127.0.0.1",body:null,query:new URLSearchParams({roomId:room})}));
    expect(res.status).toBe(200);const b=body(res.body);expect(b["status"]).toBe("idle");expect(b["accepted"]).toBe(0);expect(b["canPrepare"]).toBe(false);expect(b["snapshot"]).toBeTruthy();
  });
  it("config rejects non-loopback https/path/query/hash/creds with 0 side effects, accepts localhost/IPv6",async()=>{
    const room=service.open("",{host:HOST},KEY).roomId;
    const badOrigins=["https://127.0.0.1:4174","http://127.0.0.1:4174/path","http://127.0.0.1:4174?x=1","http://127.0.0.1:4174#h","http://user:pass@127.0.0.1:4174"];
    for(const o of badOrigins){expect(()=>createMeetWorkerHttp({origin:o,service,bridge,canPrepare:()=>false})).toThrow();}
    const ok1=createMeetWorkerHttp({origin:"http://localhost:4174",service,bridge,canPrepare:()=>false});
    const r1=await ok1(mkReq({method:"GET",path:"/api/meeting-room/worker/status",callerKey:KEY,origin:"http://localhost:4174",host:"localhost:4174",remoteAddress:"::1",body:null,query:new URLSearchParams({roomId:room})}));
    expect(r1.status).toBe(200);
    const ok2=createMeetWorkerHttp({origin:"http://[::1]:4174",service,bridge,canPrepare:()=>false});
    const r2=await ok2(mkReq({method:"GET",path:"/api/meeting-room/worker/status",callerKey:KEY,origin:"http://[::1]:4174",host:"[::1]:4174",remoteAddress:"::ffff:127.0.0.1",body:null,query:new URLSearchParams({roomId:room})}));
    expect(r2.status).toBe(200);expect(launches).toBe(0);expect(finishSpy).toHaveBeenCalledTimes(0);
  });
});
