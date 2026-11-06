export const CANDIDATE_CONTEXT_CLIENT_JS = `(function(){const ROOT_ID='mr-root',SEC_ID='mr-context-section',TA_ID='mr-context-text',SAVE_ID='mr-context-save',APP_ID='mr-context-approve',DENY_ID='mr-context-deny',STAT_ID='mr-context-status';let gen=0,busy=false,loading=false,curRoom='',preview=null,roomEl=null,sec,ta,saveBtn,approveBtn,denyBtn,statusEl;function setStatus(m){if(!statusEl||statusEl.textContent===m)return;statusEl.textContent=m;var l=document.getElementById('mr-live');if(l)l.textContent=m;}function isValidPreview(p){return p&&typeof p==='object'&&!Array.isArray(p)&&Object.keys(p).length===6&&'requestId' in p&&'redactedText' in p&&'version' in p&&'previewHash' in p&&'expiresAt' in p&&'status' in p&&typeof p.requestId==='string'&&/^[0-9a-f]{32}$/.test(p.requestId)&&typeof p.redactedText==='string'&&p.redactedText.length<=8000&&Number.isSafeInteger(p.version)&&p.version>0&&typeof p.previewHash==='string'&&/^[0-9a-f]{64}$/.test(p.previewHash)&&Number.isFinite(p.expiresAt)&&p.expiresAt>Date.now()&&p.status==='pending';}
function snap(){return window.__mrSnap||null;}
function isOrdinaryPending(s){return s&&s.candidate&&s.candidate.status==='pending'&&s.view&&s.view.twinStatus==='active'&&s.demo===null;}
function updateDisabled(){
 let hasValid=!!(preview&&isValidPreview(preview)&&preview.expiresAt>Date.now());
 let expired=preview&&preview.expiresAt<=Date.now();
 let changed=hasValid&&ta.value!==preview.redactedText;
 let nonBlank=ta.value.trim()!==''&&ta.value.length<=8000;
 ta.disabled=!hasValid||busy;
 saveBtn.disabled=!hasValid||busy||!changed||!nonBlank;
 approveBtn.disabled=!hasValid||busy||changed;
 denyBtn.disabled=!hasValid||busy;
 if(!hasValid&&!busy){
  if(expired) setStatus('Context expired. Waiting for updated context.');
 } else if(changed&&hasValid) setStatus('Save your edits before approving.');
}
function clearAuthority(msg){
 preview=null;
 ta.value='';
 updateDisabled();
 if(msg){sec.hidden=false;setStatus(msg);}else{sec.hidden=true;}
}
function hideEditor(){
 preview=null;ta.value='';sec.hidden=true;updateDisabled();
}
async function doFetch(){
 if(busy||loading) return;
 const myGen=gen;const rid=curRoom;loading=true;
 try{
  const r=await fetch('/api/meeting-room/candidate-context?roomId='+encodeURIComponent(rid),{credentials:'same-origin'});
  if(myGen!==gen||rid!==curRoom) return;
  if(!r.ok) throw 0;
  const j=await r.json();
  if(myGen!==gen||rid!==curRoom) return;
  const p=j.preview;
  if(p===null){clearAuthority('');return;}
  if(!isValidPreview(p)) throw 0;
  if(preview&&p.requestId===preview.requestId&&p.version===preview.version&&p.previewHash===preview.previewHash){
   preview=p;updateDisabled();return;
  }
  preview=p;ta.value=p.redactedText;sec.hidden=false;setStatus('Check this redacted meeting context before allowing the AI to draft your email.');updateDisabled();
 }catch(e){
  if(myGen!==gen||rid!==curRoom) return;
  clearAuthority('Could not load context. Please wait for a fresh review.');
 }finally{if(myGen===gen) loading=false;}
}
async function doPost(action){
 if(busy||!preview) return;
 if(preview.expiresAt<=Date.now()){clearAuthority('Context expired. Please wait for updated context.');return;}
 if(!isValidPreview(preview)) return;
 if(action==='approve'&&ta.value!==preview.redactedText){setStatus('Save your edits before approving.');updateDisabled();return;}
 if(action==='correct'){if(ta.value.trim()===''||ta.value.length>8000) return;}
 gen++;loading=false;const myGen=gen,rid=curRoom,body={action:action,roomId:rid,requestId:preview.requestId,version:preview.version,previewHash:preview.previewHash};
 if(action==='correct') body.text=ta.value;
 busy=true;updateDisabled();ta.disabled=true;saveBtn.disabled=true;approveBtn.disabled=true;denyBtn.disabled=true;
 try{
  const r=await fetch('/api/meeting-room/candidate-context',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(myGen!==gen||rid!==curRoom) return;
  if(!r.ok) throw 0;
  const j=await r.json();
  if(myGen!==gen||rid!==curRoom) return;
  if(action==='approve'){if(j.approved!==true||Object.keys(j).length!==1) throw 0;clearAuthority('Context approved. Waiting for the AI suggestion.');return;}
  if(action==='deny'){if(j.denied!==true||Object.keys(j).length!==1) throw 0;clearAuthority('AI drafting canceled.');return;}
  const p=j.preview;if(!isValidPreview(p)) throw 0;preview=p;ta.value=p.redactedText;setStatus('Edits saved.');updateDisabled();
 }catch(e){
  if(myGen!==gen||rid!==curRoom) return;
  clearAuthority('Request failed. Please wait for a fresh review.');
 }finally{if(myGen===gen){busy=false;updateDisabled();}}
}
function sync(){
 const root=document.getElementById(ROOT_ID);if(!root) return;
 const newRoom=root.getAttribute('data-room-id')||'';
 if(newRoom!==curRoom){curRoom=newRoom;gen++;busy=false;loading=false;hideEditor();setStatus('');}
 const s=snap();
 if(!s||s.demo!==null){hideEditor();gen++;busy=false;loading=false;if(statusEl) setStatus('');return;}
 if(!isOrdinaryPending(s)){hideEditor();gen++;busy=false;loading=false;return;}
 if(busy||loading) return;
 doFetch();
}
function init(){
 const root=document.getElementById(ROOT_ID);if(!root) return;roomEl=root;
 sec=document.createElement('section');sec.id=SEC_ID;sec.hidden=true;
 const h=document.createElement('h2');h.textContent='Review context before AI drafting';
 const p=document.createElement('p');p.textContent='Check this redacted meeting context before allowing the AI to draft your email.';
 const lab=document.createElement('label');lab.setAttribute('for',TA_ID);lab.textContent='Context';
 ta=document.createElement('textarea');ta.id=TA_ID;
 statusEl=document.createElement('div');statusEl.id=STAT_ID;
 saveBtn=document.createElement('button');saveBtn.id=SAVE_ID;saveBtn.textContent='Save context edits';
 approveBtn=document.createElement('button');approveBtn.id=APP_ID;approveBtn.textContent='Approve context for AI';
 denyBtn=document.createElement('button');denyBtn.id=DENY_ID;denyBtn.textContent='Cancel AI drafting';
 ta.addEventListener('input',updateDisabled);
 saveBtn.addEventListener('click',function(){doPost('correct');});
 approveBtn.addEventListener('click',function(){doPost('approve');});
 denyBtn.addEventListener('click',function(){doPost('deny');});
 sec.appendChild(h);sec.appendChild(p);sec.appendChild(lab);sec.appendChild(ta);sec.appendChild(saveBtn);sec.appendChild(approveBtn);sec.appendChild(denyBtn);sec.appendChild(statusEl);
 root.insertAdjacentElement('afterend',sec);
 updateDisabled();
 const obs=new MutationObserver(sync);obs.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['data-room-id']});
 sync();
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);else init();})();`;
