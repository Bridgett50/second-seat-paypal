import { describe, it, expect } from "vitest";
import { createGoogleDraftAdapter, googleDraftPackageHash } from "../src/googleDraft.js";
import type { GoogleDraftPackage } from "../src/googleDraft.js";
const pkg={to:"alice@example.com",subject:"Résumé 😀",body:"Hi 😀\r\nSecond\nDone"} as const;
const approvedOriginalHash=googleDraftPackageHash(pkg);
describe("googleDraft",()=>{
 it("success frozen receipt and exact MIME/fetch",async()=>{
 let typedArgs: Parameters<typeof fetch> | null=null;
 let fetchCalls=0;
 const fetcher=(...args: Parameters<typeof fetch>)=>{ fetchCalls++; typedArgs=args as Parameters<typeof fetch>; return Promise.resolve(new Response(JSON.stringify({id:"draft-1",message:{id:"msg-1"}}),{status:200})); };
 const getToken=(_k:string)=>"test-token"; const claimApproval=(_k:string,_h:string)=>true; const isCurrent=(_k:string,_h:string)=>true;
 const adapter=createGoogleDraftAdapter({fetcher:fetcher as typeof fetch,getToken,claimApproval,isCurrent});
 const c=new AbortController(); const r=await adapter("browser-A",pkg,c.signal);
 expect(fetchCalls).toBe(1);
 const h=googleDraftPackageHash(pkg);
 expect(Object.isFrozen(r)).toBe(true); expect(r).toEqual({status:"created",draftId:"draft-1",messageId:"msg-1",packageHash:h});
 expect(typedArgs).not.toBeNull(); const [url,init]=typedArgs!;
 expect(url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/drafts");
 expect((init as RequestInit).method).toBe("POST"); expect((init as RequestInit).redirect).toBe("error");
 const hdrs=(init as RequestInit).headers as Record<string,string>; expect(hdrs["Authorization"]).toBe("Bearer test-token"); expect(hdrs["Content-Type"]).toBe("application/json");
 expect((init as RequestInit).signal).toBe(c.signal);
 const body=JSON.parse((init as RequestInit).body as string); const raw=body.message.raw as string;
 const mime=Buffer.from(raw.replace(/-/g,"+").replace(/_/g,"/"),"base64").toString("utf8");
 expect(mime).toContain("To: alice@example.com"); expect(mime).toContain("Content-Transfer-Encoding: base64");
 const parts=mime.split("\r\n\r\n"); const b64body=parts.slice(1).join("\r\n\r\n").replace(/\s/g,"");
 expect(Buffer.from(b64body,"base64").toString("utf8")).toBe(pkg.body);
 });
 it("denied cases no fetch",async()=>{
 const mk=(ov:Partial<{fetcher:typeof fetch,claimApproval:(k:string,h:string)=>boolean,isCurrent:(k:string,h:string)=>boolean,signal:AbortSignal,pkg2:GoogleDraftPackage}>={})=>{
 let calls=0; const fetcher=((..._a:Parameters<typeof fetch>)=>{calls++; return Promise.resolve(new Response("{}",{status:200}));}) as unknown as typeof fetch;
 const c2=ov.signal??new AbortController().signal;
 return {callsRef:()=>calls, fetcher:ov.fetcher??fetcher, pkg2:ov.pkg2??pkg, signal:c2, claim:ov.claimApproval, isCur:ov.isCurrent};
 };
 // denied approval
 let s=mk({claimApproval:()=>false});
 let a=createGoogleDraftAdapter({fetcher:s.fetcher,getToken:(_k:string)=>"test-token",claimApproval:s.claim!,isCurrent:(_k:string,_h:string)=>true});
 let rc=await a("browser-A",pkg,s.signal); expect(rc.status).toBe("denied"); expect(s.callsRef()).toBe(0);
 // pre-aborted
 const ac=new AbortController(); ac.abort(); s=mk({signal:ac.signal});
 a=createGoogleDraftAdapter({fetcher:s.fetcher,getToken:(_k:string)=>"test-token",claimApproval:(_k:string,_h:string)=>true,isCurrent:(_k:string,_h:string)=>true});
 rc=await a("browser-A",pkg,s.signal); expect(rc.status).toBe("denied"); expect(s.callsRef()).toBe(0);
 // edited recipient changes hash -> denied
 const edited={...pkg,to:"bob@example.com"}; s=mk({pkg2:edited, claimApproval:(k,h)=>k==="browser-A"&&h===approvedOriginalHash});
 a=createGoogleDraftAdapter({fetcher:s.fetcher,getToken:(_k:string)=>"test-token",claimApproval:s.claim!,isCurrent:(_k:string,_h:string)=>true});
 rc=await a("browser-A",edited,s.signal); expect(rc.status).toBe("denied"); expect(s.callsRef()).toBe(0);
 });
 it("provider throw unconfirmed frozen once",async()=>{
 let calls=0; const fetcher=((..._a:Parameters<typeof fetch>)=>{calls++; throw new Error("provider-private");}) as unknown as typeof fetch;
 const adapter=createGoogleDraftAdapter({fetcher,getToken:(_k:string)=>"test-token",claimApproval:(_k:string,_h:string)=>true,isCurrent:(_k:string,_h:string)=>true});
 const r=await adapter("browser-A",pkg,new AbortController().signal); const h=googleDraftPackageHash(pkg);
 expect(Object.isFrozen(r)).toBe(true); expect(r).toEqual({status:"unconfirmed",packageHash:h}); expect(calls).toBe(1);
 });
 it("concurrent once claim",async()=>{
 let fetchCalls=0; const fetcher=((..._a:Parameters<typeof fetch>)=>{fetchCalls++; return Promise.resolve(new Response(JSON.stringify({id:"draft-1",message:{id:"msg-1"}}),{status:200}));}) as unknown as typeof fetch;
 let avail=true; const claimApproval=(_k:string,_h:string)=>{ if(avail){avail=false; return true;} return false; };
 const adapter=createGoogleDraftAdapter({fetcher,getToken:(_k:string)=>"test-token",claimApproval,isCurrent:(_k:string,_h:string)=>true});
 const [r1,r2]=await Promise.all([adapter("browser-A",pkg,new AbortController().signal),adapter("browser-A",pkg,new AbortController().signal)]);
 const statuses=[r1.status,r2.status].sort(); expect(statuses).toEqual(["created","denied"]); expect(fetchCalls).toBe(1);
 });
 it("expired or missing token and provider 401 ask the owner to reconnect Gmail; Send is never called",async()=>{
 const h=googleDraftPackageHash(pkg); const seen:string[]=[];
 const f401: typeof fetch=(input)=>{seen.push(String(input)); return Promise.resolve(new Response("{}",{status:401}));};
 const none=createGoogleDraftAdapter({fetcher:f401,getToken:(_k:string)=>null,claimApproval:(_k:string,_h:string)=>true,isCurrent:(_k:string,_h:string)=>true});
 expect(await none("browser-A",pkg,new AbortController().signal)).toEqual({status:"denied",packageHash:h,reason:"Reconnect Gmail"});
 expect(seen).toEqual([]);
 const expired=createGoogleDraftAdapter({fetcher:f401,getToken:(_k:string)=>"expired-token",claimApproval:(_k:string,_h:string)=>true,isCurrent:(_k:string,_h:string)=>true});
 const r=await expired("browser-A",pkg,new AbortController().signal);
 expect(Object.isFrozen(r)).toBe(true); expect(r).toEqual({status:"unconfirmed",packageHash:h,reason:"Reconnect Gmail"});
 expect(seen).toEqual(["https://gmail.googleapis.com/gmail/v1/users/me/drafts"]);
 const f500: typeof fetch=()=>Promise.resolve(new Response("{}",{status:500}));
 const other=createGoogleDraftAdapter({fetcher:f500,getToken:(_k:string)=>"test-token",claimApproval:(_k:string,_h:string)=>true,isCurrent:(_k:string,_h:string)=>true});
 expect(await other("browser-A",pkg,new AbortController().signal)).toEqual({status:"unconfirmed",packageHash:h});
 });
});
