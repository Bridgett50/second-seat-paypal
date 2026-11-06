import type { Page } from "@playwright/test";
const CANON=/^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
function parseMeetUrl(u:string):string|null{
try{
const p=new URL(u);
if(p.protocol!=="https:"||p.hostname!=="meet.google.com"||p.username||p.password||p.port||p.hash)return null;
const path=p.pathname;
let code:string|null=null;
const m1=path.match(/^\/([a-z]{3}-[a-z]{4}-[a-z]{3})$/);
const m2=path.match(/^\/meet\/([a-z]{3}-[a-z]{4}-[a-z]{3})$/);
if(m1)code=m1[1]??null;else if(m2)code=m2[1]??null;else return null;
if(code===null)return null;
// match the meeting code only; the query string (authuser, hl, pli, ...) is ignored
return `https://meet.google.com/${code}`;
}catch{return null;}
}
export const MEET_CAPTION_REGION_SELECTOR='[role="region"][aria-label="Captions"]';
// Several caption regions can be attached; read the first visible one (an attached zero-size region means nobody is speaking yet).
export const MEET_CAPTION_REGION_PICK=" >> visible=true >> nth=0";
const meetStepLogged=new Set<string>();
function logMeetStepOnce(tag:string):void{if(meetStepLogged.has(tag))return;meetStepLogged.add(tag);console.warn("[meet-step] failed: "+tag);}
export const MEET_CAPTION_REGION_ALT_SELECTOR='[role="region"][aria-label*="captions" i]:not([aria-label*="translat" i]):not([aria-label*="gemini" i])';
type DiagLoc={getAttribute(name:string):Promise<string|null>;innerText():Promise<string>};
export type MeetDiagPage={locator(selector:string):{all():Promise<DiagLoc[]>}};
export function redactMeetDiagnostic(s:string):string{return s.replace(/[^\s@()<>,;:"'\[\]]+@[^\s@()<>,;:"'\[\]]+/g,"[email]");}
export async function collectMeetUiDiagnostic(page:MeetDiagPage):Promise<string>{
const kinds:[string,string][]=[["button",'button:not([role]), [role="button"]'],["checkbox",'input[type="checkbox"]:not([role]), [role="checkbox"]'],["switch",'[role="switch"]'],["region",'[role="region"]']];
const lines:string[]=[];
for(const [role,sel] of kinds){
let els:DiagLoc[]=[];
try{els=await page.locator(sel).all();}catch{els=[];}
for(const el of els.slice(0,60)){
let name:string|null=null;
try{name=await el.getAttribute("aria-label");}catch{name=null;}
if((name===null||name.trim()==="")&&role!=="region"){try{name=(await el.innerText()).split("\n")[0]??"";}catch{name=null;}}
const n=redactMeetDiagnostic((name??"").replace(/\s+/g," ").trim()).slice(0,80);
// Caption toggles (switch, checkbox, or a button named for captions) also log their on/off state.
let state="";
if(role==="switch"||role==="checkbox"||(role==="button"&&/caption/i.test(n))){
let pressed:string|null=null;let checked:string|null=null;
try{pressed=await el.getAttribute("aria-pressed");}catch{pressed=null;}
try{checked=await el.getAttribute("aria-checked");}catch{checked=null;}
if(pressed!==null)state+=" pressed="+pressed.slice(0,8);
if(checked!==null)state+=" checked="+checked.slice(0,8);
}
lines.push(role+": "+(n===""?"(unnamed)":n)+state);
}
}
return lines.join("\n");
}
const meetDiagnosticLogged=new Set<string>();
let zeroRowReads=0;
export async function logMeetUiDiagnosticOnce(page:MeetDiagPage,log:(s:string)=>void=(s)=>{console.log(s);},tag:"enable"|"zero-rows"="enable"):Promise<void>{
if(meetDiagnosticLogged.has(tag))return;
meetDiagnosticLogged.add(tag);
const head=tag==="zero-rows"?"[meet-diagnostic] caption region present but 0 rows; caption UI controls (role: name):\n":"[meet-diagnostic] caption UI controls (role: name):\n";
try{log(head+await collectMeetUiDiagnostic(page));}catch{}
}
type CapsuleNode={
readonly children:ArrayLike<CapsuleNode>;
readonly tagName:string;
readonly classList:{contains(c:string):boolean};
querySelectorAll(sel:string):ArrayLike<CapsuleNode>;
readonly offsetParent:unknown;
readonly innerText:string;
};
export async function readMeetCaptionRows(page:Page,scope:Readonly<{meetingUrl:string}>,signal:AbortSignal,isCurrent:()=>boolean):Promise<readonly Readonly<{rowIndex:number;speaker:string;text:string;verified:false}>[]>{
type Row=Readonly<{rowIndex:number;speaker:string;text:string;verified:false}>;
const empty=():readonly Row[]=>Object.freeze([] as Row[]);
const fail=()=>empty();
try{
if(!scope||typeof scope.meetingUrl!=="string"||!CANON.test(scope.meetingUrl))return fail();
const approved=scope.meetingUrl;
const guard=():boolean=>{
if(signal.aborted)return false;
if(isCurrent()!==true)return false;
const cur=parseMeetUrl(page.url());
return cur!==null&&cur===approved;
};
if(!guard())return fail();
const leaveBtn=page.getByRole("button",{name:"Leave call",exact:true});
if(!guard())return fail();
const leaveCount=await leaveBtn.count();
if(!guard())return fail();
if(leaveCount<1)return fail();
if(!guard())return fail();
// Meet can render more than one Leave call button; a strict isVisible would throw, so check each match by index.
let leaveVisible=false;
if(leaveCount===1)leaveVisible=await leaveBtn.isVisible();
else for(let i=0;i<Math.min(leaveCount,8)&&!leaveVisible;i++){leaveVisible=await leaveBtn.nth(i).isVisible();if(!guard())return fail();}
if(!guard())return fail();
if(!leaveVisible)return fail();
if(!guard())return fail();
let regionSel=MEET_CAPTION_REGION_SELECTOR;
let region=page.locator(regionSel);
if(!guard())return fail();
let regionCount=await region.count();
if(!guard())return fail();
if(regionCount===0){regionSel=MEET_CAPTION_REGION_ALT_SELECTOR;region=page.locator(regionSel);regionCount=await region.count();if(!guard())return fail();}
if(regionCount===0){logMeetStepOnce("captions.reader.regionCount");void logMeetUiDiagnosticOnce(page);return fail();}
region=page.locator(regionSel+MEET_CAPTION_REGION_PICK);
const pickedCount=await region.count();
if(!guard())return fail();
const regionVisible=await region.isVisible();
if(!guard())return fail();
const zeroRows=async():Promise<readonly Row[]>=>{
zeroRowReads+=1;
if(zeroRowReads===20)await logMeetUiDiagnosticOnce(page,undefined,"zero-rows");
return empty();
};
if(pickedCount===0||!regionVisible)return zeroRows();
if(!guard())return fail();
const raw=await region.evaluate((regionEl: CapsuleNode)=>{
type StyleBag={readonly display:string;readonly visibility:string};
type StyleGetter={(el:CapsuleNode):StyleBag};
const getStyle=(globalThis as unknown as {getComputedStyle:StyleGetter}).getComputedStyle;
const isVis=(el:CapsuleNode):boolean=>{
if(!el.offsetParent)return false;
const s=getStyle(el);
if(s.display==="none")return false;
if(s.visibility==="hidden")return false;
return true;
};
const rows=Array.from(regionEl.children).filter((e:CapsuleNode)=>e.tagName==="DIV"&&e.classList.contains("nMcdL"));
if(rows.length===0){
// structure-based fallback: a visible row DIV with >=2 visible DIV children (speaker block first, text block last)
const kidsOf=(n:CapsuleNode):CapsuleNode[]=>Array.from(n.children).filter((k:CapsuleNode)=>k.tagName==="DIV"&&isVis(k));
return Array.from(regionEl.children).filter((e:CapsuleNode)=>e.tagName==="DIV"&&isVis(e)&&kidsOf(e).length>=2).map((r:CapsuleNode)=>{
const kids=kidsOf(r);
const sh=kids[0]??null;
const st=kids[kids.length-1]??null;
if(sh===null||st===null)return null;
const speaker=(sh.innerText.split("\n")[0]??"").trim();
const text=st.innerText.trim();
if(!speaker||!text)return null;
return {speaker,text};
});
}
return rows.map((r: CapsuleNode)=>{
const headers=r.querySelectorAll(":scope > div.adE6rb");
const texts=r.querySelectorAll(":scope > div.ygicle");
if(headers.length!==1||texts.length!==1)return null;
const h=headers[0]??null;
const t=texts[0]??null;
if(h===null||t===null)return null;
if(!isVis(r))return null;
if(!isVis(h))return null;
if(!isVis(t))return null;
const speakerEls=h.querySelectorAll("div.KcIKyf");
if(speakerEls.length!==1)return null;
const spEl=speakerEls[0]??null;
if(spEl===null)return null;
if(!isVis(spEl))return null;
const speaker=(spEl.innerText as string).trim();
const text=(t.innerText as string).trim();
if(!speaker||!text)return null;
return {speaker,text};
});
});
if(!guard())return fail();
if(!raw)return fail();
if(raw.length===0)return zeroRows();
zeroRowReads=0;
if(raw.length>30)return fail();
const out:{rowIndex:number;speaker:string;text:string;verified:false}[]=[];
for(let i=0;i<raw.length;i++){
const e=raw[i];
if(e===undefined||e===null)return fail();
if(typeof e.speaker!=="string"||typeof e.text!=="string")return fail();
if(e.speaker.length>200||e.text.length>2000)return fail();
out.push(Object.freeze({rowIndex:i,speaker:e.speaker,text:e.text,verified:false as const}));
}
if(!guard())return fail();
return Object.freeze(out);
}catch{return empty();}
}
