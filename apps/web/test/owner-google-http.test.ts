import {describe,it,expect,vi} from "vitest";
import {createGoogleConnections} from "./../src/googleConnections.js";
import {createOwnerGoogleHttp} from "./../src/ownerGoogleHttp.js";
import type {MeetWorkerRequest} from "./../src/meetWorkerHttp.js";
const origin="http://127.0.0.1:4173";const redirectUri=origin+"/api/google/oauth/callback";
const fakeJson={access_token:"synthetic-access-not-live",refresh_token:"synthetic-refresh-not-live",token_type:"Bearer",expires_in:3600,scope:"https://www.googleapis.com/auth/calendar.events.readonly"};
function mkFetch(){return vi.fn<typeof fetch>(async()=>new Response(JSON.stringify(fakeJson),{status:200}));}
function mkConn(fetchFn:typeof fetch){return createGoogleConnections({clientId:"synthetic-client",clientSecret:"synthetic-client-secret-not-live",redirectUri,now:()=>1000,fetcher:fetchFn});}
function req(o:Partial<MeetWorkerRequest>={}):MeetWorkerRequest{return{method:"POST",path:"/api/google/connect",callerKey:"browser-A",origin,host:"127.0.0.1:4173",remoteAddress:"127.0.0.1",body:{purpose:"calendar-read"},query:new URLSearchParams(),...o};}
function hdrs(h:Record<string,string>){expect(h["Cache-Control"]).toBe("no-store");expect(h["Referrer-Policy"]).toBe("no-referrer");expect(h["Content-Type"]).toMatch(/application\/json/);expect(Object.keys(h).some(k=>k.toLowerCase().startsWith("access-control-"))).toBe(false);}
function noSecrets(v:unknown){const s=JSON.stringify(v);expect(s).not.toMatch(/synthetic-access-not-live|synthetic-refresh-not-live|synthetic-code|synthetic-client-secret-not-live/);}
function parseBody(b:unknown):Record<string,unknown>{expect(typeof b==="object"&&b!==null).toBe(true);return b as Record<string,unknown>;}
describe("owner-google-http",()=>{
  it("real begin/callback/status/disconnect",async()=>{
    const fake=mkFetch();const conns=mkConn(fake);const app=createOwnerGoogleHttp({origin,connections:conns});
    const r1=await app(req());hdrs(r1.headers);expect(r1.status).toBe(200);const b1=parseBody(r1.body);const url=new URL(b1["authorizationUrl"] as string);
    expect(url.hostname).toBe("accounts.google.com");expect(url.pathname).toBe("/o/oauth2/v2/auth");expect(url.searchParams.get("scope")).toBe(fakeJson.scope);expect(url.searchParams.get("state")).toMatch(/^[0-9a-f]{64}$/);expect(url.searchParams.get("code_challenge_method")).toBe("S256");expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);noSecrets(r1.body);
    const state=url.searchParams.get("state")!;const cbQ=new URLSearchParams({state,code:"synthetic-code"});
    const cbB=await app(req({method:"GET",path:"/api/google/oauth/callback",callerKey:"browser-B",origin:null,query:cbQ,body:undefined}));expect(cbB.status).toBe(303);expect(cbB.headers["Location"]).toBe("/meeting-room?google=not-connected");expect(fake).toHaveBeenCalledTimes(0);noSecrets(cbB.body);noSecrets(cbB.headers["Location"]);noSecrets(cbB.headers);
    const cbA=await app(req({method:"GET",path:"/api/google/oauth/callback",origin:null,query:cbQ,body:undefined}));expect(cbA.status).toBe(303);expect(cbA.headers["Location"]).toBe("/meeting-room?google=connected");expect(fake).toHaveBeenCalledTimes(1);noSecrets(cbA.body);noSecrets(cbA.headers["Location"]);noSecrets(cbA.headers);
    const rep=await app(req({method:"GET",path:"/api/google/oauth/callback",origin:null,query:cbQ,body:undefined}));expect(rep.status).toBe(303);expect(rep.headers["Location"]).toBe("/meeting-room?google=not-connected");expect(fake).toHaveBeenCalledTimes(1);noSecrets(rep);noSecrets(rep.headers["Location"]);noSecrets(rep.headers);
    const st=await app(req({method:"GET",path:"/api/google/status",origin:null,query:new URLSearchParams()}));expect(st.status).toBe(200);const sb=parseBody(st.body);const conns2=sb["connections"] as unknown[];expect(conns2).toEqual([{purpose:"calendar-read",expiresAt:3601000}]);noSecrets(st.body);
    const disc=await app(req({method:"POST",path:"/api/google/disconnect",body:{}}));expect(disc.status).toBe(200);expect(parseBody(disc.body)["disconnected"]).toBe(true);
    const st2=await app(req({method:"GET",path:"/api/google/status",origin:null,query:new URLSearchParams()}));expect((parseBody(st2.body)["connections"] as unknown[]).length).toBe(0);expect(fake).toHaveBeenCalledTimes(1);
  });
  it("boundary rejects before controller",async()=>{
    const fake=mkFetch();const conns=mkConn(fake);const app=createOwnerGoogleHttp({origin,connections:conns});
    const beginSpy=vi.spyOn(conns,"begin");const statusSpy=vi.spyOn(conns,"status");const completeSpy=vi.spyOn(conns,"complete");const discSpy=vi.spyOn(conns,"disconnect");
    const remotes:Array<string|null>=[null,"10.0.0.1","127.0.0.2","::ffff:10.0.0.1"];
    for(const ra of remotes){const r=await app(req({remoteAddress:ra}));expect(r.status).toBe(403);hdrs(r.headers);}
    for(const h of ["evil.com",null] as Array<string|null>){const r=await app(req({host:h}));expect(r.status).toBe(403);}
    for(const o of [null,"http://evil.com"] as Array<string|null>){const r=await app(req({origin:o}));expect(r.status).toBe(403);}
    for(const o of ["http://evil.com"] as string[]){const r=await app(req({method:"GET",path:"/api/google/status",origin:o,query:new URLSearchParams()}));expect(r.status).toBe(403);}
    expect(beginSpy).toHaveBeenCalledTimes(0);expect(statusSpy).toHaveBeenCalledTimes(0);expect(completeSpy).toHaveBeenCalledTimes(0);expect(discSpy).toHaveBeenCalledTimes(0);expect(fake).toHaveBeenCalledTimes(0);
    const ok=await app(req({method:"GET",path:"/api/google/status",query:new URLSearchParams()}));expect(ok.status).toBe(200);
  });
  it("delegation preserved",async()=>{
    const fake=mkFetch();const conns=mkConn(fake);const app=createOwnerGoogleHttp({origin,connections:conns});
    const u1=await app(req({callerKey:null}));expect(u1.status).toBe(401);hdrs(u1.headers);noSecrets(u1.body);
    const nf=await app(req({path:"/api/google/unknown"}));expect(nf.status).toBe(404);
    const m1=await app(req({method:"GET",path:"/api/google/connect",origin:null,query:new URLSearchParams()}));expect(m1.status).toBe(405);expect(m1.headers["Allow"]).toBe("POST");
    const m2=await app(req({method:"POST",path:"/api/google/status",query:new URLSearchParams()}));expect(m2.status).toBe(405);expect(m2.headers["Allow"]).toBe("GET");
    for(const b of [{purpose:"calendar-read",ownerId:"x"},{purpose:"bad-purpose"},{},null] as unknown[]){const r=await app(req({body:b}));expect(r.status).toBe(400);}
    const dx=await app(req({path:"/api/google/disconnect",body:{extra:1}}));expect(dx.status).toBe(400);expect(fake).toHaveBeenCalledTimes(0);noSecrets(dx.body);
  });
  it("constructor rejects/accepts",async()=>{
    const bad=["https://127.0.0.1:4173","https://example.com","http://example.com","http://127.0.0.1:4173/","http://127.0.0.1:4173/path","http://127.0.0.1:4173?x=1","http://127.0.0.1:4173#h","http://user:pass@127.0.0.1:4173"];
    for(const o of bad){const c=mkConn(mkFetch());expect(()=>createOwnerGoogleHttp({origin:o,connections:c})).toThrow();}
    for(const o of ["http://localhost:4173","http://127.0.0.1:4173","http://[::1]:4173"]){const c=mkConn(mkFetch());const app=createOwnerGoogleHttp({origin:o,connections:c});const u=new URL(o);
      const r=await app({method:"GET",path:"/api/google/status",callerKey:"k",origin:null,host:u.host,remoteAddress:"127.0.0.1",body:undefined,query:new URLSearchParams()});expect(r.status).toBe(200);hdrs(r.headers);}
  });
});
