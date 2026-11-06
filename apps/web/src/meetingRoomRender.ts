// Server-rendered twin meeting room page (session B2).
//
// Plain TypeScript returning HTML strings, like render.ts. All dynamic text
// and attribute values are escaped with the local `esc`. T2 labels come only
// from `@second-seat/bot/dist/src/t2-room.js`; the snapshot type comes from
// `./meetingRoom.js`. No frameworks, no dependencies, no external resources.

import {
  A11Y_LABELS,
  A11Y_LIVE_REGION,
  A11Y_REGION_ORDER,
  MAILTO_LABEL,
  pluginControlId,
  pluginControlLabel,
} from "@second-seat/bot/dist/src/t2-room.js";
import { THEME_CSS, twinStageHtml } from "./theme.js";
import type { MeetingRoomSnapshot } from "./meetingRoom.js";
import { CANDIDATE_CONTEXT_CLIENT_JS } from "./candidateContextClient.js";
import { MEETING_INPUT_CLIENT_JS } from "./meetingInputClient.js";
import { MEET_WORKER_CLIENT_JS } from "./meetWorkerClient.js";
import { GOOGLE_CONNECT_CLIENT_JS } from "./googleConnectClient.js";
import { OWNER_DRAFT_CLIENT_JS } from "./ownerDraftClient.js";

/** Escape dynamic text and attribute values for HTML. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function headingFor(region: string, snap: MeetingRoomSnapshot): string {
  switch (region) {
    case "meeting":
      return snap.view.twinIdentity;
    case "demo":
      return "Guided demo";
    case "stream":
      return "Live transcript";
    case "guidance":
      return "Guide the twin";
    case "takeover":
      return "Take over";
    case "package":
      return "Draft follow-up package";
    case "plugins":
      return "Plugins";
    case "approval":
      return "Approve and send";
    case "compare":
      return "Imported email comparison";
    case "evidence":
      return "Evidence record";
    default:
      return region;
  }
}

function sectionOpen(region: string): string {
  return `<section aria-labelledby="mr-${region}-heading">` +
    `<h2 id="mr-${region}-heading">`;
}

function meetingSection(snap: MeetingRoomSnapshot): string {
  const view = snap.view;
  const options = view.meetings
    .map(
      (m) =>
        `<option value="${esc(m.id)}"${m.id === view.selectedMeetingId ? " selected" : ""}>${esc(m.title)}</option>`,
    )
    .join("");
  const restored = snap.restored
    ? `<p>Restored from the shared room store (draft, send state and approval stay while this server keeps the room).</p>`
    : "";
  return (
    `${sectionOpen("meeting")}${esc(headingFor("meeting", snap))}</h2>` +
    `<p>Owner: ${esc(view.ownerName)} · Meeting: ${esc(view.selectedMeetingTitle)} · Twin: ${esc(view.twinStatus)}</p>` +
    restored +
    `<label>Meeting:<select id="meeting-picker" aria-label="${esc(A11Y_LABELS["meeting-picker"])}" data-mr-action="select-meeting">${options}</select></label>` +
    `</section>`
  );
}

function demoSection(snap: MeetingRoomSnapshot): string {
  const demo = snap.demo;
  if (demo === null) return "";
  const label = demo.stepLabel ?? "Demo complete";
  const caption = demo.done ? "Demo complete" : (demo.caption ?? "");
  const dis = demo.done ? " disabled" : "";
  return (
    `${sectionOpen("demo")}${esc(headingFor("demo", snap))}</h2>` +
    `<p>Synthetic walkthrough of the twin room. Nothing here is real data and nothing is really sent.</p>` +
    `<p id="demo-status" role="status" aria-label="${esc(label)}">${esc(caption)}</p>` +
    `<p id="demo-progress">${demo.completed} / ${demo.total}</p>` +
    (demo.sendNote === null ? "" : `<p id="demo-send-note" role="note">${esc(demo.sendNote)}</p>`) +
    `<div><button type="button" id="demo-next" aria-label="${esc(A11Y_LABELS["demo-next"])}" data-mr-action="demo-next"${dis}>Next step</button> ` +
    `<button type="button" id="demo-restart" aria-label="${esc(A11Y_LABELS["demo-restart"])}" data-mr-action="demo-restart">Restart demo</button></div>` +
    `<p>Shortcuts: Right arrow or N advances one step, R restarts. Keys typed in inputs are ignored.</p>` +
    `</section>`
  );
}

function streamSection(snap: MeetingRoomSnapshot): string {
  const view = snap.view;
  const steered = new Set(view.steeredLines);
  const items = view.transcript
    .map(
      (line, i) =>
        `<li>${esc(line)}${steered.has(i) ? ` <span>· steered by your guidance (private)</span>` : ""}</li>`,
    )
    .join("");
  const empty =
    view.transcript.length === 0
      ? `<p>Waiting for the first scripted line…</p>`
      : "";
  return (
    `${sectionOpen("stream")}${esc(headingFor("stream", snap))}</h2>` +
    empty +
    `<ol id="mr-transcript">${items}</ol>` +
    `<div><button type="button" id="stream-next" aria-label="${esc(A11Y_LABELS["stream-next"])}" data-mr-action="stream-next">Stream next line</button></div>` +
    `</section>`
  );
}

function guidanceSection(snap: MeetingRoomSnapshot): string {
  const items = snap.view.guidance.map((g) => `<li>${esc(g)}</li>`).join("");
  const list =
    snap.view.guidance.length > 0
      ? `<p>Private guidance (only you see this)</p><ul>${items}</ul>`
      : "";
  return (
    `${sectionOpen("guidance")}${esc(headingFor("guidance", snap))}</h2>` +
    `<p>Private guidance for the twin. It stays private to the owner.</p>` +
    `<div><input id="guidance-input" type="text" value="" aria-label="${esc(A11Y_LABELS["guidance-input"])}" placeholder="Guide the twin…"> ` +
    `<button type="button" id="guidance-send" aria-label="${esc(A11Y_LABELS["guidance-send"])}" data-mr-action="guide">Guide</button></div>` +
    list +
    `</section>`
  );
}

function takeoverSection(snap: MeetingRoomSnapshot): string {
  const takenOver = snap.view.twinStatus !== "active";
  const dis = takenOver ? " disabled" : "";
  const note = takenOver ? `<p>You took over. The twin is paused.</p>` : "";
  const resumeBtn = takenOver ? `<button type="button" id="resume" aria-label="${esc(A11Y_LABELS.resume)}" data-mr-action="resume">Resume twin</button>` : "";
  return (
    `${sectionOpen("takeover")}${esc(headingFor("takeover", snap))}</h2>` +
    `<p>Pause the twin and take over the meeting yourself.</p>` +
    note +
    `<div><button type="button" id="takeover" aria-label="${esc(A11Y_LABELS.takeover)}" data-mr-action="takeover"${dis}>Take over</button>${resumeBtn}</div>` +
    `</section>`
  );
}

function packageSection(snap: MeetingRoomSnapshot): string {
  const view = snap.view;
  const locked = view.draft.sendState === "sent";
  const dis = locked ? " disabled" : "";
  const lockNote = locked
    ? `<p>Sent — package locked. Export, edit, and re-approve are disabled; the evidence record below stays.</p>`
    : "";
  const approvalNote =
    snap.approvalNote !== null ? `<p>${esc(snap.approvalNote)}</p>` : "";
  return (
    `${sectionOpen("package")}${esc(headingFor("package", snap))}</h2>` +
    `<p>sha256: ${esc(view.draft.sha256)}</p>` +
    approvalNote +
    lockNote +
    `<p id="package-dirty" hidden>Unsaved edit. Save it, then review and approve before sending.</p>` +
    `<pre>${esc(view.draft.body)}</pre>` +
    `<p id="package-base-note">The editor holds your text only. Included plugin sections are added after it and managed with Include and Exclude; the full package is shown above.</p>` +
    `<label>Draft edit:<textarea id="package-editor" rows="8" cols="60" aria-label="${esc(A11Y_LABELS["package-editor"])}"${dis}>${esc(view.draft.base)}</textarea></label>` +
    `<div><button type="button" id="package-save" aria-label="${esc(A11Y_LABELS["package-save"])}" data-mr-action="edit-draft"${dis}>Save edit</button></div>` +
    `</section>`
  );
}

function pluginsSection(snap: MeetingRoomSnapshot): string {
  const view = snap.view;
  const runnable = view.twinStatus === "active" && view.draft.sendState === "unsent";
  const runBtn =
    `<p><button type="button" id="run-plugins" aria-label="${esc(A11Y_LABELS["run-plugins"])}" ` +
    `data-mr-action="run-plugins"${runnable ? "" : " disabled"}>Run plugins</button></p>`;
  const hint =
    view.plugins.length === 0
      ? `<p>No plugin outputs yet. Stream transcript lines, then Run plugins.</p>`
      : "";
  const rows = view.plugins
    .map((p) => {
      const lines = p.lines.length > 0 ? `<pre>${esc([p.title, ...p.lines].join("\n"))}</pre>` : "";
      const status = `<p>Status: ${esc(p.status)}${p.stale ? " · stale: newer lines available" : ""}</p>`;
      const includeBtn =
        `<button type="button" id="${esc(pluginControlId("include", p.id))}" ` +
        `aria-label="${esc(pluginControlLabel("include", p.id))}" ` +
        `data-mr-action="plugin-include" data-mr-id="${esc(p.id)}">Include</button>`;
      const excludeBtn =
        `<button type="button" id="${esc(pluginControlId("exclude", p.id))}" ` +
        `aria-label="${esc(pluginControlLabel("exclude", p.id))}" ` +
        `data-mr-action="plugin-exclude" data-mr-id="${esc(p.id)}">Exclude</button>`;
      const refreshBtn =
        p.status === "approved" && p.stale
          ? ` <button type="button" id="${esc(pluginControlId("refresh", p.id))}" ` +
            `aria-label="${esc(pluginControlLabel("refresh", p.id))}" ` +
            `data-mr-action="plugin-refresh" data-mr-id="${esc(p.id)}">Refresh</button>`
          : "";
      return (
        `<div><p>${esc(p.label)}</p>` +
        lines +
        status +
        `<div>${includeBtn} ${excludeBtn}${refreshBtn}</div></div>`
      );
    })
    .join("");
  return (
    `${sectionOpen("plugins")}${esc(headingFor("plugins", snap))}</h2>` +
    `<p>Synthetic local-only helpers. Proposed outputs are excluded from the package until the owner includes them.</p>` +
    runBtn +
    hint +
    rows +
    `</section>`
  );
}

function approvalSection(snap: MeetingRoomSnapshot): string {
  const view = snap.view;
  const approved = view.draft.approved ? "yes" : "no";
  const locked = view.draft.sendState === "sent";
  const dis = locked ? " disabled" : "";
  const refusal = view.refusal !== null ? `<p>${esc(view.refusal)}</p>` : "";
  const approvalNote =
    snap.approvalNote !== null ? `<p>${esc(snap.approvalNote)}</p>` : "";
  const sendNote = snap.fakeSend
    ? ""
    : `<p id="send-refused-note">Sending is refused on this host. The server only sends in local loopback test mode.</p>`;
  const sendText = snap.fakeSend ? "Send (test fake transport)" : "Send (refused on this host)";
  const sendDescribedBy = snap.fakeSend ? "" : ` aria-describedby="send-refused-note"`;
  const sendAriaLabel = snap.fakeSend ? A11Y_LABELS.send : "Send (refused on this host)";
  const copyEnabled = view.draft.approved === true && view.draft.sendState === "unsent" && view.twinStatus === "active";
  const copyDis = copyEnabled ? "" : " disabled";
  return (
    `${sectionOpen("approval")}${esc(headingFor("approval", snap))}</h2>` +
    `<p id="mr-approval-state">Approved: ${approved} · Send: ${esc(view.draft.sendState)}</p>` +
    `<p>sha256: ${esc(view.draft.sha256)}</p>` +
    approvalNote +
    refusal +
    sendNote +
    `<div><button type="button" id="approve" aria-label="${esc(A11Y_LABELS.approve)}" data-mr-action="approve" data-mr-package="${esc(snap.packageId)}"${dis}>Approve</button> ` +
    `<button type="button" id="send" aria-label="${esc(sendAriaLabel)}" data-mr-action="send" data-mr-package="${esc(snap.packageId)}"${sendDescribedBy}>${esc(sendText)}</button></div>` +
    `<div><button type="button" id="mr-copy-email" data-mr-package="${esc(snap.packageId)}" aria-label="${esc(MEETING_ROOM_EXTRA_LABELS["mr-copy-email"] ?? "")}"${copyDis}>Copy approved email</button></div>` +
    (snap.sendNotice
      ? `<p id="send-notice" role="alert" class="mr-send-notice">${esc(snap.sendNotice)}</p>`
      : "") +
    `</section>`
  );
}

/** The guided step-7 comparison kept in the snapshot, in the same <pre> form the client shows. */
function keptComparisonHtml(snap: MeetingRoomSnapshot): string {
  const kept = snap.demo?.comparison;
  return kept === undefined || kept === null ? "" : `<pre>${esc(JSON.stringify(kept, null, 2))}</pre>`;
}

function compareSection(snap: MeetingRoomSnapshot): string {
  return (
    `${sectionOpen("compare")}${esc(headingFor("compare", snap))}</h2>` +
    `<p>Synthetic draft import only — paste text or read a local file. Compare sends this text to this app's server; this demo does not call an external model or send email.</p>` +
    `<label>Imported draft:<textarea id="compare-input" rows="6" cols="60" aria-label="${esc(A11Y_LABELS["compare-input"])}"></textarea></label>` +
    `<div><input id="compare-file" type="file" accept=".txt,.eml,text/plain" aria-label="${esc(A11Y_LABELS["compare-file"])}"> ` +
    `<button type="button" id="compare-run" aria-label="${esc(A11Y_LABELS["compare-run"])}" data-mr-action="compare">Compare</button></div>` +
    `<div id="compare-result">${keptComparisonHtml(snap)}</div>` +
    `</section>`
  );
}

function evidenceSection(snap: MeetingRoomSnapshot): string {
  const copy =
    snap.copyText !== null ? `<p id="evidence-copy">${esc(snap.copyText)}</p>` : "";
  const mailto =
    snap.mailtoHref !== null
      ? `<p><a id="evidence-mailto" href="${esc(snap.mailtoHref)}">${esc(MAILTO_LABEL)}</a></p>`
      : "";
  const intro =
    !snap.view.draft.approved && snap.view.draft.sendState === "unsent"
      ? `<p>Unsent evidence preview for the selected meeting\u2019s current draft. Nothing has been sent. Synthetic data only.</p>`
      : `<p>Evidence record for the selected meeting\u2019s package (send state shown below). Synthetic data only.</p>`;
  return (
    `${sectionOpen("evidence")}${esc(headingFor("evidence", snap))}</h2>` +
    intro +
    `<div><button type="button" id="evidence-export" aria-label="${esc(A11Y_LABELS["evidence-export"])}" data-mr-action="evidence-export">Export evidence JSON</button></div>` +
    `<pre id="evidence-json">${esc(typeof snap.demo?.evidenceJson === "string" ? snap.demo.evidenceJson : snap.evidencePreviewJson)}</pre>` +
    copy +
    mailto +
    `</section>`
  );
}

function canAdopt(snap: MeetingRoomSnapshot): boolean {
  const c = snap.candidate;
  const p = snap.candidatePreview;
  if (!c || !p) return false;
  if (snap.demo !== null) return false;
  if (snap.view.twinStatus !== "active") return false;
  if (snap.view.draft.sendState !== "unsent") return false;
  if (c.status !== "provisional") return false;
  if (p.status !== "released") return false;
  if (c.candidateId === null || p.candidateId !== c.candidateId) return false;
  if (c.contextRevision === null) return false;
  if (!snap.conversation || c.contextRevision !== snap.conversation.contextRevision) return false;
  if (!snap.sessionPolicy || p.generation !== snap.sessionPolicy.generation) return false;
  return true;
}
function previewHtml(snap: MeetingRoomSnapshot): string {
  const p = snap.candidatePreview;
  if (!p) return "";
  const hasEval = typeof p.evaluatedSubject === "string" || typeof p.evaluatedBody === "string";
  if (!hasEval) return "";
  const subj = typeof p.evaluatedSubject === "string" ? p.evaluatedSubject : "";
  const body = typeof p.evaluatedBody === "string" ? p.evaluatedBody : "";
  const reason = p.reason ? `<p>${esc(p.reason)}</p>` : "";
  const changed = (p.subjectChanged ? " · subject updated" : "") + (p.bodyChanged ? " · body updated" : "");
  const header = `<p>Evaluated suggestion — not approved, not sent${esc(changed)}</p>`;
  const subjLine = subj ? `<p>Subject: ${esc(subj)}</p>` : "";
  const bodyLine = body ? `<pre>${esc(body)}</pre>` : "";
  const statusNote = p.status !== "released" ? `<p>Status: ${esc(p.status)}</p>` : "";
  let btn = "";
  if (canAdopt(snap)) {
    const cid = esc(p.candidateId);
    const cr = String(snap.candidate!.contextRevision);
    const pg = String(p.generation);
    btn = `<button type="button" id="mr-adopt-candidate" aria-label="${esc(MEETING_ROOM_EXTRA_LABELS["mr-adopt-candidate"] ?? "")}" data-mr-action="adopt-candidate" data-mr-candidate-id="${cid}" data-mr-context-revision="${esc(cr)}" data-mr-policy-generation="${esc(pg)}">Use this email</button>`;
  }
  return header + statusNote + reason + subjLine + bodyLine + btn;
}
function candidateSection(snap: MeetingRoomSnapshot): string {
  const c = snap.candidate;
  if (!c) return "";
  const note = esc(c.note);
  const statusLine = `<p>Status: ${esc(c.status)}</p><p>${note}</p>`;
  const meta = `<p>Private provisional candidate — not policy-checked, not approved, not sent.</p>`;
  let body = "";
  if (c.status === "provisional" && c.subject !== null && c.body !== null) {
    const ctx = c.contextRevision !== null ? `<p>contextRevision: ${esc(String(c.contextRevision))}</p>` : "";
    const src = c.sourceRefs.length ? `<p>Sources: ${esc(c.sourceRefs.map(s=> s.utteranceId + " rev " + String(s.revision)).join(", "))}</p>` : "";
    body = ctx + src + `<p>Subject: ${esc(c.subject)}</p><pre>${esc(c.body)}</pre>`;
  } else if (c.status === "pending") {
    body = `<p>Drafting a private provisional candidate.</p>`;
  } else if (c.status === "failed") {
    body = "";
  }
  const preview = previewHtml(snap);
  return `<section id="mr-candidate-panel" aria-labelledby="mr-candidate-heading"><h2 id="mr-candidate-heading">Proposed email (private provisional)</h2>` + meta + statusLine + body + preview + `</section>`;
}

function sectionFor(region: string, snap: MeetingRoomSnapshot): string {
  switch (region) {
    case "meeting":
      return meetingSection(snap);
    case "demo":
      return demoSection(snap);
    case "stream":
      return streamSection(snap);
    case "guidance":
      return guidanceSection(snap);
    case "takeover":
      return takeoverSection(snap);
    case "package":
      return packageSection(snap);
    case "plugins":
      return pluginsSection(snap);
    case "approval":
      return approvalSection(snap);
    case "evidence":
      return evidenceSection(snap);
    default:
      return "";
  }
}

/**
 * The inner HTML of `<div id="mr-root" data-room-id="...">`, re-rendered
 * after each action. Region sections follow A11Y_REGION_ORDER (the demo
 * section only when `snap.demo !== null`), with the imported-email
 * comparison section between approval and evidence.
 */
export function renderMeetingRoomBody(snap: MeetingRoomSnapshot): string {
  const parts: string[] = [];
  for (const region of A11Y_REGION_ORDER) {
    const html = sectionFor(region, snap);
    if (html !== "") parts.push(html);
    if (region === "approval") parts.push(compareSection(snap));
  }
  const cand = candidateSection(snap);
  if (cand) parts.push(cand);
  return parts.join("\n");
}

export const MEETING_ROOM_EXTRA_LABELS: Readonly<Record<string, string>> = { "mr-adopt-candidate": "Use this email", "mr-copy-email": "Copy approved email" };

const CLIENT_JS = `(function(){
"use strict";
var root=document.getElementById("mr-root");
var live=document.getElementById("mr-live");
if(!root||!live){return;}
var roomId=root.getAttribute("data-room-id")||"";
function say(msgs){
  live.textContent="";
  for(var i=0;i<msgs.length;i+=1){
    var p=document.createElement("p");
    p.textContent=msgs[i];
    live.appendChild(p);
  }
}
function fieldValue(id){
  var el=document.getElementById(id);
  return el?el.value:"";
}
var seq=0;
var dirty=false;
var copyBusy=false;
var OUTGOING={"approve":true,"send":true,"evidence-export":true,"adopt-candidate":true};
function lockOutgoing(){
  var ids=["approve","send","evidence-export","mr-adopt-candidate","mr-copy-email"];
  for(var i=0;i<ids.length;i+=1){
    var b=document.getElementById(ids[i]);
    if(b){b.disabled=true;}
  }
  var gone=["evidence-copy","evidence-mailto","evidence-download"];
  for(var j=0;j<gone.length;j+=1){
    var el=document.getElementById(gone[j]);
    if(el&&el.parentNode){el.parentNode.removeChild(el);}
  }
  var pre=document.getElementById("evidence-json");
  if(pre){pre.textContent="";}
  var note=document.getElementById("package-dirty");
  if(note){note.hidden=false;}
}
var pollSeq=0;
var pollGen=0;
var pollTimer=null;
var pollInFlight=false;
var POLL_INTERVAL=1500;
var pollActive=false;
var pollEligible=root.getAttribute("data-poll-eligible")==="1";
var pollDeadline=0;
var pollExpired=false;
var pollExpiryTimer=null;
function escHtml(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
function hasCandidatePanel(){ return !!document.getElementById("mr-candidate-panel"); }
function isExpired(){ return pollExpired || (pollDeadline!==0 && Date.now()>=pollDeadline); }
function ensureExpiredNotice(){
  var panel=document.getElementById("mr-candidate-panel");
  if(!panel) return;
  if(document.getElementById("mr-candidate-expired")) return;
  var p=document.createElement("p");
  p.id="mr-candidate-expired";
  p.setAttribute("role","status");
  p.textContent="Automatic updates paused after 10 minutes; this proposed email may be stale. Refresh the page to resume automatic updates.";
  panel.appendChild(p);
}
function handleExpiry(){
  if(pollExpired) return;
  pollExpired=true;
  pollActive=false;
  pollGen+=1;
  if(pollTimer){ clearTimeout(pollTimer); pollTimer=null; }
  if(pollExpiryTimer){ clearTimeout(pollExpiryTimer); pollExpiryTimer=null; }
  ensureExpiredNotice();
}
function ensureExpiryTimer(){
  if(pollExpiryTimer) return;
  if(!pollDeadline) return;
  var d=pollDeadline - Date.now();
  if(d<=0){ handleExpiry(); return; }
  pollExpiryTimer=setTimeout(handleExpiry,d);
}
function ensureUnavailableNotice(){
  var panel=document.getElementById("mr-candidate-panel");
  if(!panel) return;
  if(document.getElementById("mr-candidate-unavailable")) return;
  var p=document.createElement("p");
  p.id="mr-candidate-unavailable";
  p.setAttribute("role","status");
  p.textContent="Automatic updates are unavailable right now; this proposed email may be stale. Retrying automatically.";
  panel.appendChild(p);
}
function removeUnavailableNotice(){
  var n=document.getElementById("mr-candidate-unavailable");
  if(n) n.remove();
}
function isValidSnapshot(snap){
  if(!snap||typeof snap!=="object") return false;
  var cand=snap.candidate;
  var view=snap.view;
  if(cand!==null){
    if(!cand||typeof cand!=="object") return false;
    var st=cand.status;
    if(st!=="none"&&st!=="pending"&&st!=="provisional"&&st!=="failed") return false;
    if(st==="provisional"){
      if(typeof cand.subject!=="string"||typeof cand.body!=="string") return false;
    }
  }
  if(!view||typeof view!=="object") return false;
  return true;
}
function stopPolling(){ pollActive=false; pollGen+=1; if(pollTimer){ clearTimeout(pollTimer); pollTimer=null; } }
function schedulePoll(){ if(!pollActive) return; if(isExpired()){ handleExpiry(); return; } if(pollTimer) clearTimeout(pollTimer); pollTimer=setTimeout(doPoll,POLL_INTERVAL); }
function canAdoptClient(snap){
  var c=snap.candidate; var p=snap.candidatePreview;
  if(!c||!p) return false;
  if(snap.demo!==null) return false;
  if(!snap.view || snap.view.twinStatus!=="active") return false;
  if(snap.view.draft.sendState!=="unsent") return false;
  if(c.status!=="provisional") return false;
  if(p.status!=="released") return false;
  if(!c.candidateId || p.candidateId!==c.candidateId) return false;
  if(c.contextRevision===null||c.contextRevision===undefined) return false;
  if(!snap.conversation || c.contextRevision!==snap.conversation.contextRevision) return false;
  if(!snap.sessionPolicy || p.generation!==snap.sessionPolicy.generation) return false;
  return true;
}
function previewClientHtml(snap){
  var p=snap.candidatePreview; if(!p) return "";
  var hasEval=typeof p.evaluatedSubject==="string"||typeof p.evaluatedBody==="string"; if(!hasEval) return "";
  var subj=typeof p.evaluatedSubject==="string"?p.evaluatedSubject:"";
  var body=typeof p.evaluatedBody==="string"?p.evaluatedBody:"";
  var changed=(p.subjectChanged?" · subject updated":"")+(p.bodyChanged?" · body updated":"");
  var h='<p>Evaluated suggestion — not approved, not sent'+escHtml(changed)+'</p>';
  if(p.status!=="released") h+='<p>Status: '+escHtml(p.status)+'</p>';
  if(p.reason) h+='<p>'+escHtml(p.reason)+'</p>';
  if(subj) h+='<p>Subject: '+escHtml(subj)+'</p>';
  if(body) h+='<pre>'+escHtml(body)+'</pre>';
  if(canAdoptClient(snap)){
    var dis=dirty?" disabled":"";
    h+='<button type="button" id="mr-adopt-candidate" aria-label="${esc(MEETING_ROOM_EXTRA_LABELS["mr-adopt-candidate"] ?? "")}" data-mr-action="adopt-candidate" data-mr-candidate-id="'+escHtml(p.candidateId)+'" data-mr-context-revision="'+escHtml(String(snap.candidate.contextRevision))+'" data-mr-policy-generation="'+escHtml(String(p.generation))+'"'+dis+'>Use this email</button>';
  }
  return h;
}
function renderCandidatePanel(candidate){
  var panel=document.getElementById("mr-candidate-panel");
  if(!panel) return;
  if(!candidate){ panel.innerHTML='<h2 id="mr-candidate-heading">Proposed email (private provisional)</h2><p>Private provisional candidate — not policy-checked, not approved, not sent.</p>'; return; }
  var html='<h2 id="mr-candidate-heading">Proposed email (private provisional)</h2>';
  html+='<p>Private provisional candidate — not policy-checked, not approved, not sent.</p>';
  html+='<p>Status: '+escHtml(candidate.status)+"</p><p>"+escHtml(candidate.note||"")+"</p>";
  if(candidate.status==="provisional" && candidate.subject!==null && candidate.body!==null){
    if(candidate.contextRevision!==null && candidate.contextRevision!==undefined) html+='<p>contextRevision: '+escHtml(String(candidate.contextRevision))+'</p>';
    if(candidate.sourceRefs && candidate.sourceRefs.length) html+='<p>Sources: '+escHtml(candidate.sourceRefs.map(function(s){return s.utteranceId+" rev "+String(s.revision);}).join(", "))+'</p>';
    html+='<p>Subject: '+escHtml(candidate.subject)+'</p><pre>'+escHtml(candidate.body)+'</pre>';
  } else if(candidate.status==="pending"){ html+='<p>Drafting a private provisional candidate.</p>'; }
  if(window.__mrSnap) html+=previewClientHtml(window.__mrSnap);
  panel.innerHTML=html;
}
function doPoll(){
  if(pollInFlight) return;
  if(isExpired()){ handleExpiry(); return; }
  if(!pollEligible){ stopPolling(); return; }
  if(document.visibilityState==="hidden"){ stopPolling(); return; }
  var panel=document.getElementById("mr-candidate-panel");
  if(!panel){ stopPolling(); return; }
  var curRoom=roomId;
  pollInFlight=true;
  var myGen=pollGen;
  var mySeq=++pollSeq;
  fetch("/api/meeting-room",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({roomId:curRoom,action:"state"})}).then(function(r){
    if(!r.ok) throw new Error("bad status");
    return r.json().then(function(b){ return {ok:r.ok,status:r.status,body:b};});
  }).then(function(res){
    pollInFlight=false;
    if(myGen!==pollGen){ if(pollActive&&!isExpired()) schedulePoll(); return; }
    if(curRoom!==roomId){ if(pollActive&&!isExpired()) schedulePoll(); return; }
    if(isExpired()||pollExpired) return;
    if(!res || !res.body || !res.body.snapshot){ ensureUnavailableNotice(); if(pollActive&&!isExpired()) schedulePoll(); return; }
    var snap=res.body.snapshot;
    if(!isValidSnapshot(snap)){ ensureUnavailableNotice(); if(pollActive&&!isExpired()) schedulePoll(); return; }
    removeUnavailableNotice();
    window.__mrSnap=snap;
    pollEligible=!!(snap.candidate && snap.view && snap.view.twinStatus==="active");
    if(!snap.candidate){ stopPolling(); return; }
    if(snap.view && snap.view.twinStatus!=="active"){ stopPolling(); return; }
    renderCandidatePanel(snap.candidate);
    if(dirty) lockOutgoing();
    if(pollExpired) ensureExpiredNotice();
    if(!isExpired()) schedulePoll();
  }).catch(function(){ pollInFlight=false; if(myGen!==pollGen){ if(pollActive&&!isExpired()) schedulePoll(); return; } if(curRoom!==roomId) return; if(isExpired()||pollExpired) return; if(!pollActive) return; ensureUnavailableNotice(); if(!isExpired()) schedulePoll(); });
}
function startPolling(){
  if(isExpired()){ handleExpiry(); return; }
  if(pollActive) return;
  if(!pollEligible) return;
  if(!hasCandidatePanel()) return;
  if(document.visibilityState==="hidden") return;
  if(pollDeadline===0){ pollDeadline=Date.now()+600000; ensureExpiryTimer(); }
  pollActive=true;
  schedulePoll();
}
function syncPollingFromSnapshot(snap){
  pollEligible=!!(snap && snap.candidate && snap.view && snap.view.twinStatus==="active");
  if(!snap || !snap.candidate){ stopPolling(); return; }
  if(snap.view && snap.view.twinStatus!=="active"){ stopPolling(); return; }
  if(document.visibilityState==="hidden"){ stopPolling(); return; }
  startPolling();
}
function post(action,extra){
  seq+=1;
  pollGen+=1;
  var mine=seq;
  var body={roomId:roomId,action:action};
  if(extra){for(var k in extra){if(Object.prototype.hasOwnProperty.call(extra,k)){body[k]=extra[k];}}}
  return fetch("/api/meeting-room",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}).then(function(r){
    return r.json().then(function(b){
      if(mine!==seq){return null;}
      return{ok:r.ok,status:r.status,body:b};
    });
  });
}
function showComparison(box,c,r){
  box.textContent="";
  if(c===null||c===undefined){
    var p=document.createElement("p");
    p.textContent=r && r.length ? r : "Compare is unavailable right now.";
    box.appendChild(p);
    return;
  }
  var pre=document.createElement("pre");
  pre.textContent=JSON.stringify(c,null,2);
  box.appendChild(pre);
}
function applyResult(action,res){
  if(res===null){return;}
  var b=(res&&res.body)||{};
  if(typeof b.html==="string"){
    var keep=null;
    if(dirty&&!(action==="edit-draft"&&res.ok)){
      var ed0=document.getElementById("package-editor");
      keep=ed0?ed0.value:"";
    }
    root.innerHTML=b.html;
    var nr=root.getAttribute("data-room-id");
    if(nr){roomId=nr;}
    if(keep!==null){
      var ed1=document.getElementById("package-editor");
      if(ed1){ed1.value=keep;}
      lockOutgoing();
    }else{
      dirty=false;
    }
  if(b && b.snapshot) { window.__mrSnap=b.snapshot; syncPollingFromSnapshot(b.snapshot); }
  if(pollExpired) ensureExpiredNotice();
  }
  if(Array.isArray(b.announcements)){say(b.announcements);}
  if(action==="guide"&&res&&res.ok){
    var g=document.getElementById("guidance-input");
    if(g){g.value="";}
  }
  if(typeof b.evidenceJson==="string"){
    var pre2=document.getElementById("evidence-json");
    if(pre2){
      pre2.textContent=b.evidenceJson;
      var link=document.getElementById("evidence-download");
      if(!link){
        link=document.createElement("a");
        link.id="evidence-download";
        if(pre2.parentNode){pre2.parentNode.insertBefore(link,pre2.nextSibling);}
      }
      link.href=URL.createObjectURL(new Blob([b.evidenceJson],{type:"application/json"}));
      link.download="evidence.json";
      link.textContent="Download evidence JSON";
    }
  }
  if(b&&Object.prototype.hasOwnProperty.call(b,"comparison")){
    var box=document.getElementById("compare-result");
    if(box){showComparison(box,b.comparison,b.comparisonReason);if(b.comparisonApproved===false){var n=document.createElement("p");n.textContent="Not yet approved: compared against the current draft package. Approve it before sending.";box.appendChild(n);}}
  }
}
document.addEventListener("click",async function(e){
  var ct=e.target;
  while(ct&&ct!==document){
    if(ct.id==="mr-copy-email"&&ct.getAttribute&&ct.getAttribute("data-mr-package")){break;}
    ct=ct.parentNode;
  }
  if(ct&&ct!==document&&ct.id==="mr-copy-email"){
    if(copyBusy){return;}
    var capRoomId=roomId;
    var capPackageId=ct.getAttribute("data-mr-package");
    if(dirty){return;}
    if(!navigator.clipboard||!navigator.clipboard.writeText){say(["Copy failed: clipboard unavailable."]);return;}
    if(ct.disabled){return;}
    copyBusy=true;
    var capturedRequestSeq;
    var postPromise;
    try{
      postPromise=post("state",{});
      capturedRequestSeq=seq;
    }catch(err2){
      copyBusy=false;
      say(["Copy failed: could not copy approved email."]);
      return;
    }
    try{
      var res=await postPromise;
      if(!res||!res.ok){say(["Copy failed: could not load approved email."]);return;}
      if(!res.body||!res.body.snapshot){say(["Copy failed: could not load approved email."]);return;}
      if(res.body.snapshot.roomId!==capRoomId){say(["Copy failed: room changed."]);return;}
      if(capRoomId!==roomId){say(["Copy failed: room changed."]);return;}
      if(res.body.snapshot.packageId!==capPackageId){say(["Copy failed: package changed."]);return;}
      if(!res.body.snapshot.view||!res.body.snapshot.view.draft||res.body.snapshot.view.draft.approved!==true){say(["Copy failed: package not approved."]);return;}
      if(res.body.snapshot.view.draft.sendState!=="unsent"){say(["Copy failed: package not approved."]);return;}
      if(res.body.snapshot.view.twinStatus!=="active"){say(["Copy failed: package not approved."]);return;}
      var freshBody=res.body.snapshot.view.draft.body;
      if(typeof freshBody!=="string"){say(["Copy failed: could not load approved email."]);return;}
      var freshSha=res.body.snapshot.view.draft.sha256;
      if(typeof freshSha!=="string"){say(["Copy failed: could not load approved email."]);return;}
      var bodyBytes=new TextEncoder().encode(freshBody);
      var digest=await crypto.subtle.digest("SHA-256",bodyBytes);
      var hashArr=Array.from(new Uint8Array(digest));
      var computedSha=hashArr.map(function(b){return b.toString(16).padStart(2,"0");}).join("");
      if(computedSha!==freshSha){say(["Copy failed: SHA mismatch."]);return;}
      if(capturedRequestSeq!==seq){return;}
      if(capRoomId!==roomId){return;}
      if(dirty){return;}
      if(res.body.snapshot.packageId!==capPackageId){say(["Copy failed: package changed."]);return;}
      var curBtn=document.getElementById("mr-copy-email");
      if(!curBtn){say(["Copy failed: button changed."]);return;}
      if(curBtn.disabled){say(["Copy failed: button changed."]);return;}
      if(curBtn.getAttribute("data-mr-package")!==capPackageId){say(["Copy failed: package changed."]);return;}
      if(dirty){say(["Copy failed: unsaved changes."]);return;}
      await navigator.clipboard.writeText(freshBody);
      if(capturedRequestSeq!==seq){return;}
      if(capRoomId!==roomId){return;}
      say(["Approved email copied."]);
    }catch(err){
      if(typeof capturedRequestSeq!=="undefined"){
        if(capturedRequestSeq!==seq){return;}
        if(capRoomId!==roomId){return;}
      }
      say(["Copy failed: could not copy approved email."]);
    }finally{
      copyBusy=false;
    }
    return;
  }
  var t=e.target;
  while(t&&t!==document){
    if(t.hasAttribute&&t.hasAttribute("data-mr-action")){break;}
    t=t.parentNode;
  }
  if(!t||t===document){return;}
  var action=t.getAttribute("data-mr-action");
  if(!action){return;}
  if(dirty&&OUTGOING[action]){return;}
  var extra={};
  if(action==="approve"||action==="send"){
    var pk=t.getAttribute("data-mr-package");
    if(pk){extra.packageId=pk;}
  }
  if(action==="guide"){extra.text=fieldValue("guidance-input");}
  else if(action==="edit-draft"){extra.text=fieldValue("package-editor");}
  else if(action==="compare"){extra.text=fieldValue("compare-input");}
    if(action==="plugin-include"||action==="plugin-exclude"||action==="plugin-refresh"){
    var pid=t.getAttribute("data-mr-id");
    if(pid){extra.id=pid;}
  } else if(action==="adopt-candidate"){
    var cid=t.getAttribute("data-mr-candidate-id");
    var cr=t.getAttribute("data-mr-context-revision");
    var pg=t.getAttribute("data-mr-policy-generation");
    if(cid) extra.id=cid;
    if(cr) extra.contextRevision=Number(cr);
    if(pg) extra.policyGeneration=Number(pg);
  }
  post(action,extra).then(function(res){applyResult(action,res);});
});
document.addEventListener("input",function(e){
  var t=e.target;
  if(t&&t.id==="package-editor"){
    dirty=true;
    seq+=1;
    pollGen+=1;
    lockOutgoing();
  }
});
document.addEventListener("visibilitychange",function(){
  if(document.visibilityState==="hidden"){ stopPolling(); }
  else {
    if(pollExpired){ ensureExpiredNotice(); return; }
    var panel=document.getElementById("mr-candidate-panel");
    if(panel && roomId) startPolling();
  }
});
window.addEventListener("pagehide",function(){ stopPolling(); });
if(pollEligible && hasCandidatePanel()) startPolling();
document.addEventListener("change",function(e){
  var t=e.target;
  if(!t||!t.id){return;}
  if(t.id==="meeting-picker"){
    post("select-meeting",{id:t.value}).then(function(res){applyResult("select-meeting",res);});
    return;
  }
  if(t.id==="compare-file"){
    var f=t.files&&t.files[0];
    if(!f){return;}
    var r=new FileReader();
    r.onload=function(){
      if(typeof r.result==="string"){
        var ci=document.getElementById("compare-input");
        if(ci){ci.value=r.result;}
      }
    };
    r.readAsText(f);
  }
});
document.addEventListener("keydown",function(e){
  var t=e.target;
  var tag=t&&t.tagName?String(t.tagName).toUpperCase():"";
  if(tag==="INPUT"||tag==="TEXTAREA"||tag==="SELECT"||(t&&t.isContentEditable)){return;}
  if(e.ctrlKey||e.metaKey||e.altKey){return;}
  var next=document.getElementById("demo-next");
  var restart=document.getElementById("demo-restart");
  if(!next&&!restart){return;}
  if(e.key==="ArrowRight"||e.key==="n"){
    if(next&&!next.disabled){e.preventDefault();next.click();}
  }else if(e.key==="r"){
    if(restart){e.preventDefault();restart.click();}
  }
});
})();`;

/** Full `<!DOCTYPE html>` meeting room document with one main landmark. */
export function renderMeetingRoomPage(snap: MeetingRoomSnapshot, aiSelfSrc?: string | null, aiConfigured = false, workerConfigured = false, googleConfigured = false, googleDraftConfigured = false): string {
  const twinStage = twinStageHtml({ imageSrc: aiSelfSrc ?? null, modeLabel: workerConfigured ? 'Local Meet worker' : (aiConfigured ? "AI drafting configured" : "Offline demo"), narrowPlacement: "before", caption: aiConfigured ? "Review the redacted meeting context before AI drafting, then review the reply before using it." : "Offline meeting room with made-up meetings. The twin drafts; you approve every step before anything moves." });
  const body = renderMeetingRoomBody(snap);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Meeting room — Second Seat</title>
<link rel="icon" href="data:,">
<style>
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;max-width:60rem;margin:0 auto;padding:1rem;line-height:1.5;color:#1a1a1a;background:#f7f7f5}
h1{font-size:1.5rem;margin:.5rem 0}
h2{font-size:1.1rem;margin:0 0 .5rem}
section{background:#fff;border:1px solid #ddd;border-radius:.75rem;box-shadow:0 1px 3px rgba(0,0,0,.08);padding:1rem;margin:0 0 1rem}
textarea{width:100%;font:inherit}
pre{white-space:pre-wrap;word-break:break-word}
button{margin:.25rem;padding:.45rem 1rem;font:inherit;border-radius:.5rem;border:1px solid #c8c8c8;background:#fff;color:#1a1a1a;cursor:pointer}
button:disabled{opacity:.45;cursor:not-allowed}
${THEME_CSS}
/* Guided layout: hero, then Step 1 send the twin, Step 2 live transcript, Step 3 stop and review, Step 4 follow-up draft; developer panels last and muted. */
main{display:flex;flex-direction:column;gap:.75rem}
main>.ss-shell{order:0;background:linear-gradient(135deg,#fdf6ff,#eef4ff);border:1px solid #e3dcf5;border-radius:1rem;padding:1rem}
main>.ss-shell h1::after{content:"Bridgett AI Twin joins your meeting, listens, and drafts the follow-up for your approval.";display:block;font-size:.95rem;font-weight:400;color:#555;margin-top:.25rem}
main>#mr-integration-plugins{order:1}
main>#mr-root{order:2;display:flex;flex-direction:column}
#mr-root>section{order:6}
#mr-root>section:has(#mr-meeting-heading){order:1}
#mr-root>section:has(#mr-stream-heading){order:2}
#mr-root>section:has(#mr-package-heading){order:3}
#mr-root>section:has(#mr-plugins-heading){order:4}
#mr-root>section:has(#mr-approval-heading){order:5}
#mr-root>section:has(#mr-guidance-heading),#mr-root>section:has(#mr-takeover-heading),#mr-root>section:has(#mr-evidence-heading),#mr-root>section:has(#compare-input){order:9;opacity:.7;font-size:.9rem;background:#fafafa}
#mr-root>section:has(#mr-guidance-heading)::before{content:"Advanced / evidence";display:block;font-size:.75rem;letter-spacing:.06em;text-transform:uppercase;color:#777;margin-bottom:.25rem}
#mr-meet-controls h2::before,#mr-meet-controls>h3::before{content:"Step 1 · Send your Twin to a meeting — ";color:#6b4bd8}
#mr-stream-heading::before{content:"Step 2 · Live transcript — ";color:#6b4bd8}
#mr-meet-review>h2::before,#mr-meet-review>h3::before{content:"Step 3 · Stop & review — ";color:#6b4bd8}
#mr-package-heading::before{content:"Step 4 · Follow-up draft — ";color:#6b4bd8}
</style>
</head>
<body data-ai-drafting="${aiConfigured && snap.demo === null ? "1" : "0"}" data-meet-worker="${workerConfigured && snap.demo === null ? "1" : "0"}" data-google-connect="${googleConfigured && snap.demo === null ? "1" : "0"}" data-google-draft="${googleDraftConfigured && workerConfigured && googleConfigured && snap.demo === null ? "1" : "0"}">
<main>
<div class="ss-shell">
<div class="ss-main">
<h1>Twin meeting room</h1>
<div id="mr-live" role="${A11Y_LIVE_REGION.role}" aria-live="${A11Y_LIVE_REGION.ariaLive}" aria-label="Meeting room announcements"></div>
</div>
${twinStage}
</div>
<div id="mr-root" data-room-id="${esc(snap.roomId)}" data-poll-eligible="${snap.candidate !== null && snap.view.twinStatus === "active" ? "1" : "0"}">${body}</div>
</main>
<script>
${CLIENT_JS}
${CANDIDATE_CONTEXT_CLIENT_JS}
${MEETING_INPUT_CLIENT_JS}
${workerConfigured && snap.demo===null ? MEET_WORKER_CLIENT_JS : ''}
${googleConfigured && snap.demo===null ? GOOGLE_CONNECT_CLIENT_JS : ''}
${googleDraftConfigured && workerConfigured && googleConfigured && snap.demo===null ? OWNER_DRAFT_CLIENT_JS : ''}
</script>
</body>
</html>`;
}
