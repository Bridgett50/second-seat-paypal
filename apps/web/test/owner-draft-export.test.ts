import { test, expect } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { createHash } from "node:crypto";
import { createOwnerDraftExport } from "../src/ownerDraftExport.js";
import { createGoogleWriteOutbox } from "../src/googleWriteOutbox.js";
type Ctl={setCurrent:(v:{identity:string;body:string}|null)=>void;setClock:(n:number)=>void;setFetch:(f:typeof fetch)=>void;calls:()=>number;outbox:ReturnType<typeof createGoogleWriteOutbox>;path:string;reconstruct:()=>ReturnType<typeof createOwnerDraftExport>;cleanup:()=>void;fresh:()=>Ctl;ctrl:ReturnType<typeof createOwnerDraftExport>};
function mkFixture():Ctl{
const dir=mkdtempSync(join(tmpdir(),"owner-draft-export-"));const journalPath=join(dir,"journal.jsonl");
let current:{identity:string;body:string}|null={identity:"v1",body:"Résumé 😀\r\nBody\nDone"};
let clock=1000;let calls=0;let fakeImpl:typeof fetch=()=>Promise.resolve(new Response(JSON.stringify({id:"draft-1",message:{id:"msg-1"}}),{status:200,headers:{"content-type":"application/json"}}));
const fetcher: typeof fetch = (...args: Parameters<typeof fetch>) => { calls++; return fakeImpl(...args); };
const readCurrent=(k:string,r:string)=>k==="browser-A"&&r==="room-A"?current:null;
const getToken=(_k:string)=>"test-token";
const mkOutbox=()=>createGoogleWriteOutbox({journalPath});
let outbox=mkOutbox();
let ctrl=createOwnerDraftExport({readCurrent,getToken,outbox,fetcher,now:()=>clock});
const cleanup=()=>{try{if(resolve(dirname(dir))===resolve(tmpdir())&&basename(dir).startsWith("owner-draft-export-"))rmSync(dir,{recursive:true,force:true});}catch{};};
const reconstruct=()=>{outbox=mkOutbox();ctrl=createOwnerDraftExport({readCurrent,getToken,outbox,fetcher,now:()=>clock});return ctrl;};
return{setCurrent:(v: { identity: string; body: string } | null) => { current = v; },setClock:(n: number) => { clock = n; },setFetch:(f: typeof fetch) => { fakeImpl = f; },calls:()=>calls,outbox,path:journalPath,reconstruct,cleanup,fresh:()=>mkFixture(),ctrl,get ctrl2(){return ctrl;}} as unknown as Ctl;
}
function dkey(hash:string){return createHash("sha256").update(JSON.stringify(["browser-A","room-A","gmail-draft",hash]),"utf8").digest("hex");}
function deferred<T>(){let res!: (v:T)=>void;let rej!: (e:unknown)=>void;const p=new Promise<T>((a,b)=>{res=a;rej=b;});return{promise:p,resolve:res,reject:rej};}
function previewOf(c:Ctl){const r=c.ctrl.preview("browser-A","room-A","alice@example.com","Résumé");if(r.status!=="preview")throw new Error("preview denied");return r;}
function decodeRaw(b64:string){return Buffer.from(b64.replace(/-/g,"+").replace(/_/g,"/").replace(/\s/g,""),"base64").toString("utf8");}
test("authority+once+restart",async()=>{const f=mkFixture();try{
let r=f.ctrl.preview("browser-A","room-A","alice@example.com","Résumé");expect(r.status).toBe("preview");
let cr=await f.ctrl.create("browser-A","room-A",(r as unknown as {packageHash:string}).packageHash,new AbortController().signal);expect(cr.status).toBe("denied");expect(f.calls()).toBe(0);
const p1=previewOf(f);expect(f.ctrl.approve("browser-A","room-A",p1.packageHash).status).toBe("approved");
f.setCurrent({identity:"v1",body:"changed"});expect((await f.ctrl.create("browser-A","room-A",p1.packageHash,new AbortController().signal)).status).toBe("denied");expect(f.calls()).toBe(0);
f.setCurrent({identity:"v1",body:"Résumé 😀\r\nBody\nDone"});
const p2=previewOf(f);f.ctrl.approve("browser-A","room-A",p2.packageHash);
const p3=f.ctrl.preview("browser-A","room-A","bob@example.com","Résumé");expect(p3.status).toBe("preview");expect((await f.ctrl.create("browser-A","room-A",p1.packageHash,new AbortController().signal)).status).toBe("denied");
const pv=previewOf(f);f.ctrl.approve("browser-A","room-A",pv.packageHash);
let cap:{url:string;init:RequestInit}|null=null;f.setFetch(async (...args: Parameters<typeof fetch>) => { const [u,i]=args; cap={url:String(u),init:i??{}}; return new Response(JSON.stringify({id:"draft-1",message:{id:"msg-1"}}),{status:200,headers:{"content-type":"application/json"}}); });
// TTL check before valid dispatch
f.setClock(1000);const ttlP=previewOf(f);f.ctrl.approve("browser-A","room-A",ttlP.packageHash);f.setClock(1000+300000);expect((await f.ctrl.create("browser-A","room-A",ttlP.packageHash,new AbortController().signal)).status).toBe("denied");f.setClock(1000);const pv2=previewOf(f);f.ctrl.approve("browser-A","room-A",pv2.packageHash);
expect((await f.ctrl.create("foreign","room-A",pv2.packageHash,new AbortController().signal)).status).toBe("denied");expect(f.calls()).toBe(0);
const [a,b]=await Promise.all([f.ctrl.create("browser-A","room-A",pv2.packageHash,new AbortController().signal),f.ctrl.create("browser-A","room-A",pv2.packageHash,new AbortController().signal)]);
expect([a.status,b.status].filter(s=>s==="created").length).toBe(1);expect([a.status,b.status].filter(s=>s==="denied").length).toBe(1);expect(f.calls()).toBe(1);
const created=[a,b].find(x=>x.status==="created") as unknown as {draftId:string;messageId:string;journalStatus:string;packageHash:string};
expect(created.journalStatus).toBe("confirmed");expect(cap!.url).toContain("drafts");const rawBody=JSON.parse(String(cap!.init.body)) as {message:{raw:string}};const mime=decodeRaw(rawBody.message.raw);expect(mime).toContain("alice@example.com");const parts=mime.split("\r\n\r\n"); const b64body=parts.slice(1).join("\r\n\r\n").replace(/\s/g,""); expect(Buffer.from(b64body,"base64").toString("utf8")).toBe("Résumé 😀\r\nBody\nDone");const b64=rawBody.message.raw.replace(/\s/g,"");expect(Buffer.from(b64,"base64").toString("utf8")).toBe(mime);const j=readFileSync(f.path,"utf8");expect(j).not.toContain("Résumé 😀");expect(j).not.toContain("test-token");expect(f.outbox.lookup(dkey(pv2.packageHash))?.status).toBe("confirmed");
const c2=f.reconstruct();const pv3=c2.preview("browser-A","room-A","alice@example.com","Résumé") as unknown as {status:string;packageHash:string};expect(pv3.status).toBe("preview");c2.approve("browser-A","room-A",pv3.packageHash);expect((await c2.create("browser-A","room-A",pv3.packageHash,new AbortController().signal)).status).toBe("denied");expect(f.calls()).toBe(1);
}finally{f.cleanup();}
});
test("deferred revoke + malformed",async()=>{const f=mkFixture();try{
const df=deferred<Response>();f.setFetch((()=>df.promise) as unknown as typeof fetch);
const p=previewOf(f);f.ctrl.approve("browser-A","room-A",p.packageHash);
const pr=f.ctrl.create("browser-A","room-A",p.packageHash,new AbortController().signal);
expect(f.calls()).toBe(1);f.ctrl.invalidate("browser-A","room-A");f.setCurrent(null);df.resolve(new Response(JSON.stringify({id:"draft-1",message:{id:"msg-1"}}),{status:200,headers:{"content-type":"application/json"}}));const rc=await pr;expect(rc.status).toBe("created");expect(f.outbox.lookup(dkey(p.packageHash))?.status).toBe("confirmed");
}finally{f.cleanup();}
const g=mkFixture();try{
f.setFetch as unknown; // keep line count
const p2=previewOf(g);g.ctrl.approve("browser-A","room-A",p2.packageHash);
g.setFetch(async (...args: Parameters<typeof fetch>) => { const [u,i]=args; void u; void i; return new Response(JSON.stringify({id:"draft-1",message:{}}),{status:200,headers:{"content-type":"application/json"}}); });
const rr=await g.ctrl.create("browser-A","room-A",p2.packageHash,new AbortController().signal);
expect(rr.status).toBe("unconfirmed");expect(g.outbox.lookup(dkey(p2.packageHash))?.status).toBe("unconfirmed");expect(g.calls()).toBe(1);
expect((await g.ctrl.create("browser-A","room-A",p2.packageHash,new AbortController().signal)).status).toBe("denied");expect(g.calls()).toBe(1);
}finally{g.cleanup();}
});
test("journal settle failure",async()=>{const f=mkFixture();try{
const p=previewOf(f);f.ctrl.approve("browser-A","room-A",p.packageHash);
const ik=dkey(p.packageHash);f.setFetch(async (...args: Parameters<typeof fetch>) => { void args; try{writeFileSync(f.path+".lock","",{flag:"wx"});}catch{}; return new Response(JSON.stringify({id:"draft-1",message:{id:"msg-1"}}),{status:200,headers:{"content-type":"application/json"}}); });
const res=await f.ctrl.create("browser-A","room-A",p.packageHash,new AbortController().signal) as unknown as {status:string;journalStatus:string};
expect(res.status).toBe("created");expect(res.journalStatus).toBe("unconfirmed");expect(f.calls()).toBe(1);
try{unlinkSync(f.path+".lock");}catch{}
expect(f.outbox.lookup(ik)?.status).toBe("attempted");const c2=f.reconstruct();const pv=c2.preview("browser-A","room-A","alice@example.com","Résumé") as unknown as {status:string;packageHash:string};expect(pv.status).toBe("preview"); c2.approve("browser-A","room-A",(pv as unknown as {packageHash:string}).packageHash); expect((await c2.create("browser-A","room-A",(pv as unknown as {packageHash:string}).packageHash,new AbortController().signal)).status).toBe("denied");
}finally{f.cleanup();}
});
test("denied previews say why",()=>{const f=mkFixture();try{
expect(f.ctrl.preview("","room-A","alice@example.com","Résumé")).toEqual({status:"denied",reason:"Invalid request"});
expect(f.ctrl.preview("browser-A","room-A","not-an-email","Résumé")).toEqual({status:"denied",reason:"Invalid draft package"});
f.setCurrent(null);
expect(f.ctrl.preview("browser-A","room-A","alice@example.com","Résumé")).toEqual({status:"denied",reason:"No approved draft yet"});
f.setCurrent({identity:" ",body:"Body"});
expect(f.ctrl.preview("browser-A","room-A","alice@example.com","Résumé")).toEqual({status:"denied",reason:"Draft identity missing"});
}finally{f.cleanup();}});
