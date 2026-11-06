import type {createGoogleConnections} from "./googleConnections.js";
import {createGoogleHttp} from "./googleHttp.js";
import type {MeetWorkerRequest} from "./meetWorkerHttp.js";
function bad():never{throw new Error("Invalid configuration");}
function parseOrigin(o:string):URL{
 if(!o||o!==o.trim())bad();
 if(o.endsWith("/")||o.includes("?")||o.includes("#")||o.includes("@"))bad();
 let u:URL;try{u=new URL(o);}catch{bad();}
 if(u.protocol!=="http:")bad();
 if(u.pathname!=="/"||u.search||u.hash||u.username||u.password)bad();
 const h=u.hostname;if(h!=="localhost"&&h!=="127.0.0.1"&&h!=="::1"&&h!=="[::1]")bad();
 if(o!==u.origin)bad();return u;
}
export function createOwnerGoogleHttp(opts:{origin:string;connections:ReturnType<typeof createGoogleConnections>}){
 const cfg=parseOrigin(opts.origin);
 const cfgHost=cfg.host;const cfgOrigin=cfg.origin;
 const inner=createGoogleHttp({connections:opts.connections,origin:opts.origin});
 const base:Record<string,string>={"Cache-Control":"no-store","Referrer-Policy":"no-referrer","Content-Type":"application/json;charset=utf-8"};
 const deny=(s:number,b:unknown)=>({status:s,headers:{...base},body:b});
 return async(req:MeetWorkerRequest):Promise<{status:number;headers:Record<string,string>;body:unknown}>=>{
  try{
   const ra=req.remoteAddress;if(ra!=="127.0.0.1"&&ra!=="::1"&&ra!=="::ffff:127.0.0.1")return deny(403,{error:"Forbidden"});
   if(req.host!==cfgHost)return deny(403,{error:"Forbidden"});
   if(req.method==="POST"){if(req.origin!==cfgOrigin)return deny(403,{error:"Forbidden"});}
   else if(req.method==="GET"){if(req.origin!==null&&req.origin!==cfgOrigin)return deny(403,{error:"Forbidden"});}
   else{if(req.origin!==null&&req.origin!==cfgOrigin)return deny(403,{error:"Forbidden"});}
   const res=await inner({method:req.method,path:req.path,callerKey:req.callerKey,origin:req.origin,body:req.body,query:req.query});
   return res;
  }catch{return deny(503,{error:"Google connection unavailable"});}
 };
}
