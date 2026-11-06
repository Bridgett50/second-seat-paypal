export const MEET_WORKER_CLIENT_JS = String.raw`
(function(){
var b=document.body;if(!b||b.dataset.meetWorker!=='1')return;
var originalRoot=document.querySelector('#mr-root[data-room-id]');if(!originalRoot)return;
var root=originalRoot;var roomId=root.dataset.roomId;if(!roomId)return;
var capturedRoomId=roomId;var curStatus='idle';var canPrepareFlag=false;var wasListening=false,userStopped=false;
var gen=0,dead=false,timer=null,ctrl=null,inflight=false;
var els={};var editorRows=new Map();var dirtyWarn=null;
function abortInflight(){if(ctrl){try{ctrl.abort();}catch(e){}ctrl=null;}}
function clearTimer(){if(timer){clearTimeout(timer);timer=null;}}
function teardown(){dead=true;gen++;clearTimer();abortInflight();if(els.sec&&els.sec.parentNode)els.sec.parentNode.removeChild(els.sec);try{obs.disconnect();}catch(e){}}
function isAlive(){var r=document.querySelector('#mr-root[data-room-id]');return r&&r===originalRoot&&r.dataset.roomId===capturedRoomId;}
function validUrl(u){return /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(u);}
function validName(n){var t=n.trim();return t.length>0&&t.length<=80;}
function statusText(s){
if(s==='starting')return 'Starting worker...';
if(s==='listening')return 'Listening...';
if(s==='stopping')return 'Stopping worker...';
if(s==='stopped')return (wasListening&&!userStopped)?'Worker stopped (capture lost). You can review the transcript.':'Stopped. You can review the transcript.';
if(s==='failed')return wasListening?'Worker stopped (capture lost).':'Worker failed to start.';
if(s==='stop-unconfirmed')return 'Stop requested. Waiting for confirmation.';
return 'Idle.';
}
function isActive(s){return s==='starting'||s==='listening'||s==='stopping';}
function canConnect(){var ok=(curStatus==='idle'||curStatus==='stopped'||curStatus==='failed');return ok&&validUrl(els.inpUrl.value.trim())&&validName(els.inpName.value)&&!inflight;}
function canStop(){return isActive(curStatus)&&!inflight;}
function hasDirty(){var it=editorRows.values();var n=it.next();while(!n.done){if(n.value.dirty)return true;n=it.next();}return false;}
function deletedDirty(){var it=editorRows.values();var n=it.next();while(!n.done){if(n.value.deleted&&n.value.dirty)return true;n=it.next();}return false;}
function canPrepare(){return canPrepareFlag===true&&curStatus==='stopped'&&!inflight&&!hasDirty();}
function syncButtons(){
els.btnC.disabled=!canConnect();
els.btnS.disabled=!canStop();
if(els.btnP){var d=!canPrepare();els.btnP.disabled=d;if(!canPrepareFlag)els.btnP.title='AI drafting is not configured yet. Your transcript stays here.';else if(hasDirty())els.btnP.title='Save your transcript corrections before preparing a follow-up.';else els.btnP.title='';els.prepareNote.textContent=els.btnP.title;}
var it=editorRows.values();var r=it.next();while(!r.done){var row=r.value;var dis=curStatus!=='stopped'||inflight||row.deleted;row.btn.disabled=dis||row.ta.value.trim().length===0||row.ta.value.length>2000;row.ta.disabled=curStatus!=='stopped';r=it.next();}
}
function ensureReviewShell(){
if(els.reviewSec)return;
var sec=document.createElement('section');sec.id='mr-meet-review';
var h=document.createElement('h3');h.textContent='Transcript review';sec.appendChild(h);
var w=document.createElement('div');w.id='mr-review-rows';sec.appendChild(w);
var bp=document.createElement('button');bp.id='mr-meet-prepare';bp.type='button';bp.textContent='Prepare private follow-up';sec.appendChild(bp);
var note=document.createElement('p');note.id='mr-meet-prepare-note';sec.appendChild(note);
els.prepareNote=note;
var warn=document.createElement('p');warn.id='mr-review-warn';warn.style.display='none';warn.textContent='Transcript changed while editing. Save again to keep your version.';sec.appendChild(warn);
els.reviewSec=sec;els.reviewRows=w;els.btnP=bp;els.warnEl=warn;
els.sec.appendChild(sec);
bp.addEventListener('click',onPrepare);
}
function renderTranscript(snapshot){
ensureReviewShell();
var utterances=snapshot&&snapshot.conversation&&snapshot.conversation.utterances;
if(!Array.isArray(utterances)){els.reviewSec.style.display='none';return;}
els.reviewSec.style.display=curStatus==='stopped'?'':'none';
if(curStatus!=='stopped')return;
var seen=new Set();var serverIds=new Set();
for(var i=0;i<utterances.length;i++){
var u=utterances[i];if(!u||typeof u!=='object'||Array.isArray(u))continue;
var uid=u.utteranceId;if(typeof uid!=='string'||!uid)continue;
var rev=u.revision;if(typeof rev!=='number'||!Number.isSafeInteger(rev)||rev<=0)continue;
if(typeof u.speaker!=='string'||typeof u.text!=='string')continue;
serverIds.add(uid);seen.add(uid);
var existing=editorRows.get(uid);
if(!existing){
var row=document.createElement('div');row.dataset.utteranceId=uid;
var sp=document.createElement('span');sp.textContent=u.speaker;row.appendChild(sp);
var lab=document.createElement('label');lab.textContent='Unverified caption';row.appendChild(lab);
var ta=document.createElement('textarea');ta.maxLength=2000;ta.value=u.text;lab.appendChild(ta);
var btn=document.createElement('button');btn.type='button';btn.textContent='Save correction';row.appendChild(btn);
var entry={row:row,ta:ta,btn:btn,serverRevision:rev,serverText:u.text,expectedRevision:rev,dirty:false,deleted:false,rowBase:u.text};
(function(ent,id){
ta.addEventListener('input',function(){ent.dirty=ent.ta.value!==ent.serverText;syncButtons();});
btn.addEventListener('click',function(){onCorrect(id);});
})(entry,uid);
els.reviewRows.appendChild(row);editorRows.set(uid,entry);
} else {
if(existing.deleted){existing.deleted=false;existing.row.style.display='';}
if(rev!==existing.serverRevision){
if(existing.dirty){existing.serverRevision=rev;existing.serverText=u.text;existing.expectedRevision=rev;els.warnEl.style.display='';}
else {existing.serverRevision=rev;existing.serverText=u.text;existing.expectedRevision=rev;existing.ta.value=u.text;existing.rowBase=u.text;existing.dirty=false;els.warnEl.style.display='none';}
} else if(!existing.dirty && existing.ta.value!==u.text){existing.serverText=u.text;existing.ta.value=u.text;existing.rowBase=u.text;}
}
}
editorRows.forEach(function(v,k){if(!serverIds.has(k)){
if(v.dirty){v.deleted=true;v.row.style.display='';if(v.warnEl)v.warnEl.style.display='';v.btn.disabled=true;els.warnEl.style.display='';}
else {v.row.parentNode.removeChild(v.row);editorRows.delete(k);}
}});
syncButtons();
}
function render(data){
if(typeof data.status==='string'){curStatus=data.status;if(curStatus==='listening')wasListening=true;canPrepareFlag=data.canPrepare;els.st.textContent=statusText(curStatus);}
if(data.snapshot&&typeof data.snapshot==='object'&&!Array.isArray(data.snapshot)&&data.snapshot.roomId===capturedRoomId){
window.__mrSnap=data.snapshot;
if(typeof data.html==='string'&&root.innerHTML!==undefined)root.innerHTML=data.html;
renderTranscript(data.snapshot);
} else if(data.snapshot){return;}
syncButtons();
}
function handleResponse(json){
if(!json||typeof json.status!=='string')throw new Error('bad');
var allowed=['idle','starting','listening','stopping','stopped','failed','stop-unconfirmed'];
if(allowed.indexOf(json.status)===-1)throw new Error('bad status');
if(typeof json.accepted!=='number'||!isFinite(json.accepted)||Math.floor(json.accepted)!==json.accepted||json.accepted<0)throw new Error('bad accepted');
if(typeof json.canPrepare!=='boolean')throw new Error('bad canPrepare');
if(json.snapshot!=null){
if(typeof json.snapshot!=='object'||Array.isArray(json.snapshot))throw new Error('bad snapshot');
if(json.snapshot.roomId!==capturedRoomId)throw new Error('room mismatch');
}
if(json.html!=null&&typeof json.html!=='string')throw new Error('bad html');
return json;
}
function schedulePoll(){clearTimer();if(dead)return;
if(curStatus==='starting'||curStatus==='listening'||curStatus==='stopping'){
timer=setTimeout(function(){if(dead||!isAlive()){teardown();return;}pollStatus();},1000);
}}
async function doFetch(url,opts,myGen){
if(dead||!isAlive()){teardown();return null;}
var myCtrl=new AbortController();ctrl=myCtrl;
var o={credentials:'same-origin',redirect:'error',signal:myCtrl.signal};
if(opts){o.method=opts.method;o.headers=opts.headers;o.body=opts.body;}
try{
var r=await fetch(url,o);
if(myGen!==gen||dead||!isAlive())return null;
if(!r.ok)throw new Error('request failed');
var j=await r.json();
if(myGen!==gen||dead||!isAlive())return null;
return handleResponse(j);
}catch(e){if(e&&e.name==='AbortError')return null;if(dead||myGen!==gen||!isAlive())return null;els.st.textContent='Something went wrong. Please try again.';return null;}
finally{if(myGen===gen&&ctrl===myCtrl)ctrl=null;}
}
async function pollStatus(){
if(inflight)return;if(dead||!isAlive()){teardown();return;}
var g=gen;inflight=true;syncButtons();
try{
var d=await doFetch('/api/meeting-room/worker/status?roomId='+encodeURIComponent(capturedRoomId),{method:'GET'},g);
if(!d||g!==gen||dead||!isAlive())return;render(d);
}finally{if(g===gen)inflight=false;syncButtons();schedulePoll();}
}
async function onConnect(){
if(!canConnect())return;wasListening=false;userStopped=false;var url=els.inpUrl.value.trim();var name=els.inpName.value.trim();
els.inpUrl.value=url;els.inpName.value=name;
if(!validUrl(url)||!validName(name))return;
var g=++gen;inflight=true;syncButtons();
try{var d=await doFetch('/api/meeting-room/worker/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roomId:capturedRoomId,meetingUrl:url,displayName:name})},g);
if(!d||g!==gen||dead||!isAlive())return;render(d);}finally{if(g===gen)inflight=false;syncButtons();schedulePoll();}
}
async function onStop(){
if(!canStop())return;userStopped=true;var g=++gen;inflight=true;syncButtons();
try{var d=await doFetch('/api/meeting-room/worker/stop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roomId:capturedRoomId})},g);
if(!d||g!==gen||dead||!isAlive())return;render(d);}finally{if(g===gen)inflight=false;syncButtons();schedulePoll();}
}
async function onCorrect(utteranceId){
var entry=editorRows.get(utteranceId);if(!entry)return;
var text=entry.ta.value;if(text.trim().length===0||text.length>2000)return;
if(curStatus!=='stopped'||inflight||entry.deleted)return;
var sentRevision=entry.serverRevision;
var g=gen;inflight=true;syncButtons();
try{
var d=await doFetch('/api/meeting-room/worker/correct',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roomId:capturedRoomId,utteranceId:utteranceId,expectedRevision:entry.expectedRevision,text:text})},g);
if(!d||g!==gen||dead||!isAlive())return;render(d);
if(entry.deleted)return;
if(entry.ta.value===text&&d.snapshot){
var u=null;var arr=d.snapshot.conversation&&d.snapshot.conversation.utterances;
for(var i=0;arr&&i<arr.length;i++)if(arr[i].utteranceId===utteranceId)u=arr[i];
if(u&&u.text===text&&u.revision>sentRevision){entry.serverRevision=u.revision;entry.serverText=u.text;entry.expectedRevision=u.revision;entry.rowBase=u.text;entry.dirty=false;entry.deleted=false;els.warnEl.style.display='none';}
}
}finally{if(g===gen)inflight=false;syncButtons();schedulePoll();}
}
async function onPrepare(){
if(!canPrepare())return;var g=++gen;inflight=true;syncButtons();
try{var d=await doFetch('/api/meeting-room/worker/prepare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roomId:capturedRoomId})},g);
if(!d||g!==gen||dead||!isAlive())return;render(d);}finally{if(g===gen)inflight=false;syncButtons();schedulePoll();}
}
function getHost(){var h=document.getElementById('mr-integration-plugins');if(h)return h;h=document.createElement('section');h.id='mr-integration-plugins';h.style.cssText='display:flex;flex-wrap:wrap;gap:0.5rem;margin:0.5rem 0';var t=document.createElement('h2');t.textContent='Integration plugins';t.style.cssText='width:100%;font-size:1rem;margin:0 0 0.25rem';h.appendChild(t);root.parentNode.insertBefore(h,root);return h;}
function buildControls(){
var sec=document.createElement('section');sec.id='mr-meet-controls';sec.style.cssText='padding:0.5rem;border:1px solid #ddd;border-radius:6px;flex:1 1 280px;min-width:240px';
var h=document.createElement('h2');h.textContent='Meeting worker';h.style.cssText='font-size:1rem;margin:0 0 0.25rem';sec.appendChild(h);
var det=document.createElement('details');var sum=document.createElement('summary');sum.textContent='Meet permissions';det.appendChild(sum);
var d1=document.createElement('p');d1.textContent='Local Chrome worker. Sign in yourself when asked. Captions may mishear words. Nothing is emailed automatically.';d1.style.margin='0.25rem 0';det.appendChild(d1);
sec.appendChild(det);
var lb1=document.createElement('label');lb1.textContent='Meeting URL';lb1.htmlFor='mr-meet-url';sec.appendChild(lb1);
var inpUrl=document.createElement('input');inpUrl.id='mr-meet-url';inpUrl.type='url';inpUrl.placeholder='https://meet.google.com/aaa-bbbb-ccc';sec.appendChild(inpUrl);
var lb2=document.createElement('label');lb2.textContent='Worker label, not your Google account name.';lb2.htmlFor='mr-meet-name';sec.appendChild(lb2);
var inpName=document.createElement('input');inpName.id='mr-meet-name';inpName.type='text';inpName.value='Second Seat AI twin (test)';inpName.maxLength=80;sec.appendChild(inpName);
var exp=document.createElement('p');exp.textContent='Worker label, not your Google account name.';exp.style.cssText='font-size:0.8rem;margin:0.15rem 0';sec.appendChild(exp);
var btnC=document.createElement('button');btnC.id='mr-meet-connect';btnC.type='button';btnC.textContent='Connect my local twin';sec.appendChild(btnC);
var btnS=document.createElement('button');btnS.id='mr-meet-stop';btnS.type='button';btnS.textContent='Finish and review transcript';sec.appendChild(btnS);
var st=document.createElement('p');st.id='mr-meet-status';st.setAttribute('role','status');st.setAttribute('aria-live','polite');st.textContent='Idle.';st.style.margin='0.25rem 0';sec.appendChild(st);
els={sec:sec,inpUrl:inpUrl,inpName:inpName,btnC:btnC,btnS:btnS,st:st};
return sec;
}
var sec=buildControls();
getHost().appendChild(sec);
els.btnC.addEventListener('click',onConnect);
els.btnS.addEventListener('click',onStop);
els.inpUrl.addEventListener('input',syncButtons);
els.inpName.addEventListener('input',syncButtons);
syncButtons();
var obs=new MutationObserver(function(){if(!isAlive()){abortInflight();clearTimer();dead=true;gen++;if(els.sec&&els.sec.parentNode)els.sec.parentNode.removeChild(els.sec);try{obs.disconnect();}catch(e){}}});
obs.observe(document,{childList:true,subtree:true,attributes:true,attributeFilter:['data-room-id']});
window.addEventListener('pagehide',function(){dead=true;gen++;clearTimer();abortInflight();});
(function init(){
var g=++gen;inflight=true;syncButtons();
doFetch('/api/meeting-room/worker/status?roomId='+encodeURIComponent(capturedRoomId),{method:'GET'},g).then(function(d){
if(!d||g!==gen||dead||!isAlive())return;render(d);
}).catch(function(){}).then(function(){if(g===gen)inflight=false;syncButtons();schedulePoll();});
})();
})();
`