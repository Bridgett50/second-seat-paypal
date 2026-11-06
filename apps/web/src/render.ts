import { THEME_CSS, briefAppBarHtml, twinStageHtml } from "./theme.js";
import { modelChips, type RunLogLine } from "./modelStrip.js";
import { renderCacheRatio, type CacheUsage } from "./cacheRatio.js";
import type { PressureAssessment } from "./session.js";

export interface Citation {
  kind: string;
  segmentId: string | null;
  frameId: string | null;
  region: { x: number; y: number; w: number; h: number } | null;
}

export interface BriefEntry {
  id: string;
  category: string;
  text: string;
  speaker: string | null;
  citations: Citation[];
  flags: string[];
}

export interface Brief {
  createdAt: string;
  entries: BriefEntry[];
  flagged?: string[];
}

export interface TranscriptSegment {
  id: string;
  time: string;
  speaker: string;
  text: string;
}

export interface Frame {
  id: string;
  file: string;
  time: string;
  pngBase64?: string;
}

export interface PressureItem {
  id: string;
  text: string;
  segmentIds: string[];
}

export interface PayloadDemo {
  maskedText: string;
  fields?: { masked: string; meaning: string }[];
  note?: string;
}

export interface GlimmerAttemptInfo {
  label?: string;
  mode?: "live" | "mock";
  runId?: string;
  sourceRevision?: string;
  ranAt?: string;
  status?: "complete" | "incomplete" | "invalid";
  completedK?: number;
  completedN?: number;
  recallK?: number;
  recallN?: number;
  fullK?: number;
  fullN?: number;
}

export interface GlimmerLiveInfo extends GlimmerAttemptInfo {
  recall: string;
  n?: number;
  attempts?: GlimmerAttemptInfo[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatAttemptDate(ranAt: string): string {
  const d = new Date(ranAt);
  const month = MONTHS[d.getUTCMonth()] ?? "";
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hour = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  return `${month} ${day} ${d.getUTCFullYear()} ${hour}:${min} UTC`;
}

export function attemptMetaLine(a: GlimmerAttemptInfo): string {
  return (
    `mode ${a.mode ?? "live"} · run ${a.runId ?? "unknown"} · ` +
    `revision ${a.sourceRevision ?? "unknown"} · status ${a.status ?? "unknown"}`
  );
}

export function glimmerHeadline(a: GlimmerLiveInfo): string | null {
  if (
    a.status === undefined || a.completedK === undefined || a.completedN === undefined ||
    a.recallK === undefined || a.recallN === undefined ||
    a.fullK === undefined || a.fullN === undefined || a.ranAt === undefined
  ) {
    return null;
  }
  return (
    `Latest attempt ${formatAttemptDate(a.ranAt)} — ${a.status}: ` +
    `${a.completedK}/${a.completedN} cases completed · ` +
    `${a.recallK}/${a.recallN} legacy entity disappearance on completed cases · ` +
    `${a.fullK}/${a.fullN} full batch`
  );
}

export function isMockOrFailedRun(line: RunLogLine | undefined): boolean {
  if (line === undefined) return false;
  return (
    /mock/i.test(line.model ?? "") ||
    /mock/i.test(line.note ?? "") ||
    /\b(fail|failed|error)\b/i.test(line.note ?? "")
  );
}

export interface SeededScore {
  catchK: number;
  catchN: number;
  catchLo: number;
  catchHi: number;
  falseK: number;
  falseN: number;
}

export function seededScoreLine(score: SeededScore): string {
  return (
    `Seeded errors caught ${score.catchK}/${score.catchN} ` +
    `(95% CI ${score.catchLo.toFixed(2)}–${score.catchHi.toFixed(2)}), ` +
    `false alarms ${score.falseK}/${score.falseN}`
  );
}

export interface BriefScore {
  briefEntries: number;
  truthEntries: number;
  validatorClean: number;
  matched: number;
  categoryAgree: number;
}

export function briefScoreLine(score: BriefScore): string {
  return (
    `categories ${score.categoryAgree}/${score.matched} · ` +
    `truth entry match ${score.matched}/${score.truthEntries} · ` +
    `citations resolved ${score.validatorClean}/${score.briefEntries}`
  );
}

export interface HeroChainProof {
  /** Base64 PNG of the synthetic hero slide. */
  pngBase64: string;
  /** SAM box as CSS percentages for the overlay. */
  boxPercent: { x: number; y: number; w: number; h: number };
  /** Date read by muse-spark-1.3 in the region, if any. */
  date?: string | null;
  /** True when the slide PNG came from a model (muse-image-1.0). */
  modelGenerated: boolean;
}

export interface RenderOpts {
  /** Deprecated, ignored: the core flow is text-only and has no live-call control. */
  liveDev?: boolean;
  pressureFallback?: PressureItem[];
  payloadDemo?: PayloadDemo | null;
  glimmerLive?: GlimmerLiveInfo | null;
  briefScore?: BriefScore | null;
  seededScore?: SeededScore | null;
  heroChain?: HeroChainProof | null;
  cacheUsage?: CacheUsage[];
  /** URL of the optional AI-self image (apps/web/public/ai-self.*); null shows the initials placeholder. */
  aiSelfSrc?: string | null;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function dedupePressureItems(items: PressureItem[]): PressureItem[] {
  const seen = new Set<string>();
  const out: PressureItem[] = [];
  for (const item of items) {
    if (item.id === undefined || item.id === null || item.id === "") {
      out.push(item);
      continue;
    }
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

export function pressureItemsFor(
  brief: Brief,
  fallback: PressureItem[] = [],
): PressureItem[] {
  const derived = brief.entries
    .filter(
      (e) =>
        e.flags.some((f) => f.toLowerCase().includes("pressure")) ||
        e.category.toLowerCase().includes("pressure"),
    )
    .map((e) => ({
      id: e.id,
      text: e.text,
      segmentIds: e.citations
        .filter((c) => c.segmentId)
        .map((c) => c.segmentId as string),
    }));
  return dedupePressureItems(derived.length > 0 ? derived : fallback);
}

export function heldText(badgeCount: number): string {
  return `Held: review the ${badgeCount} pressure item${badgeCount === 1 ? "" : "s"} first`;
}

function citationLink(c: Citation): string {
  if (c.kind === "frame" && c.frameId) {
    return `<a href="#frame-${esc(c.frameId)}">[${esc(c.frameId)}]</a>`;
  }
  if (c.segmentId) {
    return `<a href="#seg-${esc(c.segmentId)}">[${esc(c.segmentId)}]</a>`;
  }
  return "";
}

export function conflictEntries(brief: Brief): BriefEntry[] {
  return brief.entries.filter(
    (e) =>
      e.category === "source_conflict" ||
      e.flags.includes("conflicting_sources"),
  );
}

function conflictsSection(brief: Brief): string {
  const conflicts = conflictEntries(brief);
  const items = conflicts
    .map(
      (e) =>
        `<article class="entry" id="entry-${esc(e.id)}"><p>${esc(e.text)}</p>` +
        `<p class="citations">${e.citations.map(citationLink).join(" ")}</p></article>`,
    )
    .join("\n");
  const body =
    conflicts.length > 0 ? items : `<p id="empty-state">No conflicting sources found.</p>`;
  return `<section id="conflicts"><h2>Conflicting sources</h2>${body}</section>`;
}

export function renderBriefPage(
  brief: Brief,
  transcriptSegments: TranscriptSegment[],
  frames: Frame[],
  runLog: RunLogLine[],
  opts: RenderOpts = {},
): string {
  void opts.liveDev; // deprecated, ignored: no live-call control in the text-only core flow.
  const chips = modelChips(runLog);
  const pressure = pressureItemsFor(brief, opts.pressureFallback ?? []);
  const byCategory = new Map<string, BriefEntry[]>();
  for (const e of brief.entries) {
    const list = byCategory.get(e.category) ?? [];
    list.push(e);
    byCategory.set(e.category, list);
  }
  const flagged = brief.entries.filter((e) => e.flags.length > 0);

  const glimmerLive = opts.glimmerLive ?? null;
  const lastByStage = new Map<string, RunLogLine>();
  for (const line of runLog) lastByStage.set(line.stage, line);
  const chipHtml = chips
    .map((c) => {
      if (c.stage === "glimmer-redact" && glimmerLive !== null) {
        const live =
          glimmerLive.status === "complete" &&
          glimmerLive.mode !== "mock" &&
          !isMockOrFailedRun(lastByStage.get(c.stage));
        if (live) {
          const suffix = glimmerLive.n !== undefined ? ` (n=${glimmerLive.n})` : "";
          return `<span class="model-chip" data-stage="glimmer-redact" data-status="live">glimmer-redact: live · legacy entity disappearance ${esc(glimmerLive.recall)}${suffix}</span>`;
        }
        return `<span class="model-chip" data-stage="glimmer-redact" data-status="incomplete">glimmer-redact: incomplete</span>`;
      }
      if (c.status === "run" && isMockOrFailedRun(lastByStage.get(c.stage))) {
        return `<span class="model-chip" data-stage="${esc(c.stage)}" data-status="not run">${esc(c.stage)}: not run</span>`;
      }
      return c.status === "run"
        ? `<span class="model-chip" data-stage="${esc(c.stage)}" data-status="run">${esc(c.stage)}: ${esc(c.model as string)}</span>`
        : `<span class="model-chip" data-stage="${esc(c.stage)}" data-status="not run">${esc(c.stage)}: not run</span>`;
    })
    .join("\n");

  const categoryHtml = [...byCategory.entries()]
    .map(
      ([cat, entries]) =>
        `<section class="category" data-category="${esc(cat)}"><h2>${esc(cat)}</h2>\n${entries
          .map(
            (e) =>
              `<article class="entry replay-item" id="entry-${esc(e.id)}"><p>${esc(e.text)}</p>` +
              (e.speaker ? `<p class="speaker">${esc(e.speaker)}</p>` : "") +
              (e.flags.length > 0
                ? `<p class="flags">flags: ${e.flags.map(esc).join(", ")}</p>`
                : "") +
              `<p class="citations">${e.citations.map(citationLink).join(" ")}</p></article>`,
          )
          .join("\n")}</section>`,
    )
    .join("\n");

  const flaggedHtml = `<section id="flagged"><h2>Flagged</h2>\n${flagged
    .map(
      (e) =>
        `<article class="entry" id="flagged-${esc(e.id)}"><p>${esc(e.text)}</p>` +
        `<p class="flags">flags: ${e.flags.map(esc).join(", ")}</p>` +
        `<p class="citations">${e.citations.map(citationLink).join(" ")}</p></article>`,
    )
    .join("\n")}</section>`;

  const renderedBadges = pressure.filter((p) => p.segmentIds.length > 0);
  const badgeHtml = renderedBadges
    .map(
      (p) =>
        `<a class="pressure-badge" href="#seg-${esc(p.segmentIds[0] as string)}">pressure: ${esc(p.id)}</a>`,
    )
    .join("\n");

  const badgeCount = renderedBadges.length;

  const frameById = new Map(frames.map((f) => [f.id, f]));
  const frameIds = new Set<string>();
  for (const e of brief.entries) {
    for (const c of e.citations) {
      if (c.kind === "frame" && c.frameId) frameIds.add(c.frameId);
    }
  }
  const frameHtml = [...frameIds]
    .map((fid) => {
      const f = frameById.get(fid);
      const region = brief.entries
        .flatMap((e) => e.citations)
        .find((c) => c.frameId === fid && c.region)?.region;
      const img =
        f?.pngBase64 && f.pngBase64.length > 0
          ? `<img src="data:image/png;base64,${f.pngBase64}" alt="${esc(f.file)}">`
          : `<span class="frame-missing">frame image missing</span>`;
      return (
        `<figure id="frame-${esc(fid)}"><figcaption>${esc(fid)}${f ? ` — ${esc(f.file)}` : ""}</figcaption>` +
        `<div class="frame-box">` +
        img +
        (region
          ? `<div class="region-overlay" style="left:${region.x}%;top:${region.y}%;width:${region.w}%;height:${region.h}%"></div>`
          : "") +
        `</div></figure>`
      );
    })
    .join("\n");

  const transcriptJson = JSON.stringify(transcriptSegments).replace(
    /</g,
    "\\u003c",
  );
  const segmentHtml = transcriptSegments
    .map(
      (s) =>
        `<li class="replay-item" id="seg-${esc(s.id)}" data-time="${esc(s.time)}"><strong>[${esc(s.time)}] ${esc(s.speaker)}:</strong> ${esc(s.text)}</li>`,
    )
    .join("\n");

  const pressureChecks = renderedBadges
    .map(
      (p) =>
        `<label class="pressure-check"><input type="checkbox" class="pressure-review" data-pressure="${esc(p.id)}"> Reviewed: ${esc(p.text)} ` +
        p.segmentIds
          .map((s) => `<a href="#seg-${esc(s)}">[${esc(s)}]</a>`)
          .join(" ") +
        `</label>`,
    )
    .join("\n");

  const draftMeetingId =
    brief.createdAt.length > 0 ? brief.createdAt : "demo-meeting";
  const draftRunId = `run-${draftMeetingId}`;
  const draftInitial =
    brief.entries[0]?.text ??
    "Thanks for sharing the details. I will review and follow up.";
  const draftInitialAttr = esc(draftInitial);
  const draftInitialHtml = draftInitialAttr.replace(
    /<\/textarea/gi,
    "&lt;/textarea",
  );

  const briefScore = opts.briefScore ?? null;
  const scoreLines: string[] = [];
  if (briefScore !== null) {
    scoreLines.push(
      `<p id="scores-brief">${esc(briefScoreLine(briefScore))}</p>`,
    );
  }
  let glimmerRunsHtml = "";
  if (glimmerLive !== null) {
    const headline = glimmerHeadline(glimmerLive);
    if (headline !== null) {
      scoreLines.push(
        `<p id="scores-glimmer">Glimmer legacy entity disappearance ${glimmerLive.recallK}/${glimmerLive.recallN} on completed cases · latest attempt ${esc(glimmerLive.status ?? "unknown")} (${glimmerLive.completedK}/${glimmerLive.completedN} cases, ${glimmerLive.fullK}/${glimmerLive.fullN} full batch)</p>`,
      );
      const spanNote = (glimmerLive as { spanNote?: string }).spanNote;
      if (spanNote) scoreLines[scoreLines.length - 1] = scoreLines[scoreLines.length - 1]!.replace("</p>", ` · requests ${glimmerLive.completedK}/${glimmerLive.completedN} · ${esc(spanNote)}</p>`);
      const previous = (glimmerLive.attempts ?? []).filter((a) => a.ranAt !== glimmerLive.ranAt);
      const previousHtml =
        previous.length > 0
          ? `<div id="scores-glimmer-previous"><h3>Previous runs</h3><ul>` +
            previous
              .map(
                (a) =>
                  `<li>${esc(a.label ?? a.ranAt ?? "run")} — ${esc(a.status ?? "unknown")}: ` +
                  `${a.completedK ?? "?"}/${a.completedN ?? "?"} cases completed · ` +
                  `${a.recallK ?? "?"}/${a.recallN ?? "?"} legacy entity disappearance · ` +
                  `${esc(attemptMetaLine(a))}</li>`,
              )
              .join("") +
            `</ul></div>`
          : "";
      glimmerRunsHtml =
        `<section id="glimmer-runs" aria-label="Glimmer runs"><h2>Glimmer runs</h2>` +
        `<p>${esc(headline)}</p>` +
        `<p id="scores-glimmer-meta">${esc(attemptMetaLine(glimmerLive))}</p>` +
        previousHtml +
        `</section>`;
    } else {
      const suffix = glimmerLive.n !== undefined ? ` (n=${glimmerLive.n})` : "";
      scoreLines.push(
        `<p id="scores-glimmer">Glimmer legacy entity disappearance ${esc(glimmerLive.recall)}${suffix}</p>`,
      );
    }
  }
  const seededScore = opts.seededScore ?? null;
  if (seededScore !== null) {
    scoreLines.push(
      `<p id="scores-seeded">${esc(seededScoreLine(seededScore))}</p>`,
    );
  }
  const scoresHtml =
    scoreLines.length > 0
      ? `<section id="scores" aria-label="Scores"><h2>Scores</h2>${scoreLines.join("\n")}</section>`
      : "";

  const heroChain = opts.heroChain ?? null;
  const heroChainHtml =
    heroChain === null
      ? ""
      : `<section id="hero-chain"><h2>Hero chain — synthetic slide</h2>` +
        `<p>${heroChain.modelGenerated ? "Model-generated synthetic image (muse-image-1.0)." : "Hand-made synthetic fallback (image generation unavailable)."}` +
        (heroChain.date ? ` Spark read the date: ${esc(heroChain.date)}.` : "") +
        `</p><div class="frame-box">` +
        `<img src="data:image/png;base64,${heroChain.pngBase64}" alt="synthetic vendor slide">` +
        `<div class="region-overlay" data-sam-box="true" style="left:${heroChain.boxPercent.x}%;top:${heroChain.boxPercent.y}%;width:${heroChain.boxPercent.w}%;height:${heroChain.boxPercent.h}%"></div>` +
        `</div></section>`;

  const payload = opts.payloadDemo;
  const payloadHtml = payload
    ? `<section id="what-left-this-server"><h2>Example payload</h2><p>Example payload (recorded fixture), not from this session.</p><pre>${esc(payload.maskedText)}</pre>` +
      (payload.note ? `<p>${esc(payload.note)}</p>` : "") +
      `</section>`
    : `<section id="what-left-this-server"><h2>Example payload</h2><p>Example payload (recorded fixture), not from this session.</p>` +
      `</section>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Brief demo — Second Seat</title>
<link rel="icon" href="data:,">
<style>
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;max-width:60rem;margin:0 auto;padding:1rem;line-height:1.5;color:#1a1a1a;background:#f7f7f5}
h1{font-size:1.5rem;margin:.5rem 0}
h2{font-size:1.1rem;margin:0 0 .5rem}
.replay-label{margin:.25rem 0 .75rem;color:#333}
#model-strip{margin:.25rem 0}
.model-chip{display:inline-block;border:1px solid #555;border-radius:999px;padding:.1rem .6rem;margin:.15rem;font-size:.85rem;background:#fff}
.model-chip[data-status="live"]{border-color:#1c6b2a;background:#e9f5ec;color:#14501f}
#hero{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin:.75rem 0}
#pressure-badges{grid-column:1/-1}
.pressure-badge{display:inline-block;background:#8f1d1d;color:#fff;border-radius:.3rem;padding:.15rem .6rem;margin:.15rem;text-decoration:none}
#conflicts,#draft,.category,#flagged,#transcript,#frames,#hero-chain,#what-left-this-server,#scores{background:#fff;border:1px solid #ddd;border-radius:.75rem;box-shadow:0 1px 3px rgba(0,0,0,.08);padding:1rem;margin:0 0 1rem;min-width:0}
#hero #scores{grid-column:1/-1;margin:0}
#scores p{margin:.25rem 0;font-size:.9rem}
#hero #conflicts,#hero #draft{margin:0;min-width:0}
#conflicts blockquote{margin:.5rem 0 0;padding:.5rem .75rem;border-left:3px solid #8f1d1d;background:#fafafa;border-radius:0 .4rem .4rem 0}
#draft-status{font-weight:600}#draft-text{display:block;width:100%;box-sizing:border-box}#draft label{font-size:.85rem}#draft p{margin:.3rem 0}#draft-advisory{font-size:.8rem;color:#555}
.pressure-check{display:block;margin:.35rem 0}
.region-overlay{position:absolute;border:2px solid red}
.frame-box{position:relative;min-height:4rem;background:#ddd}
img{max-width:100%;height:auto}
pre{white-space:pre-wrap;word-break:break-word}
button{margin:.25rem;padding:.4rem .9rem;font:inherit}
footer{margin-top:2rem;border-top:1px solid #999;padding-top:.5rem}
[hidden]{display:none!important}
body.demo #glimmer-runs,body.demo #scores-glimmer-previous,body.demo #scores-glimmer-meta,body.demo #frames{display:none}
@media (max-width:45rem){#hero{grid-template-columns:1fr}}
${THEME_CSS}</style>
</head>
<body>
${briefAppBarHtml()}
<div class="ss-shell">
<main class="ss-main">
<h1>Vendor brief — demo</h1>
<p class="replay-label">Replay of recorded brief — Analysis precomputed ${esc(brief.createdAt)}</p>
<div id="model-strip">${chipHtml}</div>
<section id="hero" aria-label="Demo hero">
<div id="pressure-badges">${badgeHtml}</div>
${conflictsSection(brief)}
<section id="draft" data-run-id="${esc(draftRunId)}">
<h2>Draft reply</h2>
<p id="draft-status">${esc(heldText(badgeCount))}</p>
<label for="draft-text">Draft reply text</label>
<textarea id="draft-text" rows="2">${draftInitialHtml}</textarea>
<label for="meeting-select">Meeting</label>
<select id="meeting-select">
<option value="${esc(draftMeetingId)}" data-flags="${badgeCount}" data-draft="${draftInitialAttr}" selected>${esc(draftMeetingId)}</option>
<option value="" data-flags="0" data-draft="">blank meeting</option>
</select>
${pressureChecks}
<p class="citations">${pressure.map((p) => p.segmentIds.map((s) => `<a href="#seg-${esc(s)}">[${esc(s)}]</a>`).join(" ")).join(" ")}</p>
<p id="draft-advisory">Commitment checks are advisory.</p>
<button type="button" id="btn-approve">Approve</button>
<button type="button" id="btn-reject">Reject</button>
<button type="button" id="btn-copy" disabled>Copy</button>
<p id="draft-note"></p>
</section>
${scoresHtml}
</section>
${glimmerRunsHtml}
${categoryHtml}
${flaggedHtml}
<section id="transcript"><h2>Transcript</h2><ol id="transcript-lines">${segmentHtml}</ol></section>
<section id="frames"><h2>Frames</h2>${frameHtml}</section>
${heroChainHtml}
${payloadHtml}
${renderCacheRatio(opts.cacheUsage ?? [])}
</main>
${twinStageHtml({ imageSrc: opts.aiSelfSrc ?? null, modeLabel: "Recorded replay", narrowPlacement: "after" })}
</div>
<footer>Second Seat never sends a reply to the vendor.</footer>
<script type="application/json" id="transcript-data">${transcriptJson}</script>
<script>
(function(){
try{if(/[?&]demo=1(&|$)/.test(location.search))document.body.classList.add("demo");}catch(e){}
function hashDraft(text){var h=0x811c9dc5;for(var i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,0x01000193);}return (h>>>0).toString(16);}
var section=document.getElementById("draft");
var meetingSelect=document.getElementById("meeting-select");
var draftText=document.getElementById("draft-text");
var approveBtn=document.getElementById("btn-approve");
var copyBtn=document.getElementById("btn-copy");
var note=document.getElementById("draft-note");
var status=document.getElementById("draft-status");
var state={meetingId:meetingSelect.value,runId:section.getAttribute("data-run-id")||"demo-run",draft:draftText.value,approval:null};
function selectedOption(){if(meetingSelect.selectedOptions&&meetingSelect.selectedOptions[0]){return meetingSelect.selectedOptions[0];}return meetingSelect.options[meetingSelect.selectedIndex];}
function isApproved(){return state.approval!==null&&state.approval.draftHash===hashDraft(state.draft)&&state.approval.runId===state.runId&&state.approval.meetingId===state.meetingId;}
function refresh(){
  var boxes=Array.prototype.slice.call(document.querySelectorAll(".pressure-review"));
  var opt=selectedOption();
  var zeroFlags=opt&&opt.getAttribute("data-flags")==="0";
  var allReviewed=boxes.every(function(b){return b.checked;});
  var approved=isApproved();
  approveBtn.disabled=!(zeroFlags||allReviewed)||approved;
  copyBtn.disabled=!approved;
  if(approved){status.textContent="Approved \u2014 copy and send it yourself.";}
  else{var n=document.querySelectorAll(".pressure-badge").length;status.textContent="Held: review the "+n+" pressure item"+(n===1?"":"s")+" first";}
}
approveBtn.addEventListener("click",function(){
  state.draft=draftText.value;state.approval={draftHash:hashDraft(state.draft),runId:state.runId,meetingId:state.meetingId};note.textContent="Approved locally. Nothing was sent.";refresh();
});
document.getElementById("btn-reject").addEventListener("click",function(){
  state.approval=null;note.textContent="Rejected locally. Nothing was sent.";refresh();
});
draftText.addEventListener("input",function(){
  state.draft=draftText.value;state.approval=null;refresh();
});
meetingSelect.addEventListener("change",function(){
  var opt=selectedOption();
  state.meetingId=meetingSelect.value;state.draft=(opt&&opt.getAttribute("data-draft"))||"";draftText.value=state.draft;state.approval=null;note.textContent="Meeting changed locally. Approval cancelled.";refresh();
});
Array.prototype.forEach.call(document.querySelectorAll(".pressure-review"),function(b){
  b.addEventListener("change",refresh);
});
copyBtn.addEventListener("click",function(){
  if(!isApproved()){return;}
  var text=draftText.value;
  if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text);}
  else{var t=document.createElement("textarea");t.value=text;document.body.appendChild(t);t.select();document.execCommand("copy");document.body.removeChild(t);}
  note.textContent="Copied locally. Nothing was sent.";
});
var replayItems=document.querySelectorAll(".replay-item");
var reduceMotion=!!(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches);
var staticMode=false;
try{staticMode=new URLSearchParams(window.location.search).get("static")==="1";}catch(e){}
if(!reduceMotion&&!staticMode){
  var i=0;
  for(var k=0;k<replayItems.length;k++){replayItems[k].hidden=true;}
  var timer=setInterval(function(){
    if(i>=replayItems.length){clearInterval(timer);return;}
    replayItems[i].hidden=false;i++;
  },250);
}
refresh();
})();
</script>
</body>
</html>`;
}

export type SessionPageSnapshot = {
  state: string;
  /** Last server revision rendered; the client script sends it back as expectedRevision. */
  revision: number;
  reason?: string;
  segments: { id: string; text: string }[];
  redactedText: string;
  approved: boolean;
  result: { offline: boolean; entries: { kind: string; text: string; segmentIds: string[]; flags?: string[] }[] } | null;
  payload: { approvedText: string; status: string; sentAt?: string; adapterLabel?: string } | null;
  superseded?: { approvedText: string; sentAt?: string; status?: string } | null;
  offline: boolean;
  draft?: { text: string; origin: string; approved: boolean } | null;
  pressure?: PressureAssessment | null;
  verification?: {
    status: "verified" | "needs_owner_review" | "structural" | "redaction_checked";
    blocked: boolean;
    title: string;
    message: string;
    checks: { id: string; label: string; result: string }[];
  } | null;
};

function pressureSourceLabel(p: { source: string; status?: string }): string {
  if (p.status === "not_run") return "not run";
  if (p.status === "failed") return "failed / unavailable";
  if (p.source === "offline-fixture") return "offline fixture";
  if (p.source === "live") return "live check";
  if (p.source === "pattern") return "deterministic pattern detection";
  if (p.source === "none") return "not run";
  return "deterministic pattern detection";
}

function sessionPressureHtml(snap: SessionPageSnapshot): string {
  const p = snap.pressure ?? null;
  if (p === null) return "";
  const status = (p as { status?: string }).status;
  if (p.items.length === 0) {
    if (status === "not_run" || status === "failed") {
      const reason = (p as { reason?: unknown }).reason;
      const reasonHtml =
        typeof reason === "string" && reason !== "" ? `<p id="pressure-reason">${esc(reason)}</p>` : "";
      return `<section id="pressure" aria-label="Possible pressure">` +
        `<h2>Possible pressure — assessment, not a judgment of anyone's intent</h2>` +
        `<p id="pressure-source">${esc(pressureSourceLabel(p))}</p>${reasonHtml}</section>`;
    }
    if (status === "valid_negative") {
      return `<section id="pressure" aria-label="Possible pressure">` +
        `<h2>Possible pressure — assessment, not a judgment of anyone's intent</h2>` +
        `<p id="pressure-source">${esc(pressureSourceLabel(p))}</p>` +
        `<p id="pressure-negative">No pressure items found</p></section>`;
    }
    return "";
  }
  const items = p.items
    .map(
      (item) =>
        `<article class="pressure-item" id="pressure-${esc(item.id)}">` +
        `<a class="pressure-badge" href="#${esc(item.segmentId)}">pressure: ${esc(item.id)}</a>` +
        `<p class="pressure-quote">${esc(item.quote)}</p>` +
        `<p class="pressure-tactic">tactic: ${esc(item.tactic)}</p>` +
        `<p class="pressure-term">unresolved term: ${esc(item.unresolvedTerm === "" ? "term not identified" : item.unresolvedTerm)}</p>` +
        `<label class="pressure-check"><input type="checkbox" class="pressure-review" data-pressure="${esc(item.id)}"${p.reviewed.includes(item.id) ? " checked" : ""}> Reviewed</label>` +
        `</article>`,
    )
    .join("\n");
  return `<section id="pressure" aria-label="Possible pressure">` +
    `<h2>Possible pressure — assessment, not a judgment of anyone's intent</h2>` +
    `<p id="pressure-source">${esc(pressureSourceLabel(p))}</p>${items}</section>`;
}

function sessionDraftHtml(snap: SessionPageSnapshot): string {
  const d = snap.draft ?? null;
  const hidden = d === null ? " hidden" : "";
  const dis = (off: boolean): string => (off ? " disabled" : "");
  const status =
    d === null
      ? "No draft yet — analyze first."
      : d.approved
        ? "Approved — ready to copy."
        : "Review — approve to copy.";
  return `<section id="draft" aria-label="Draft reply"${hidden}><h2>Draft reply</h2>` +
    `<p id="draft-origin">Written by you — not generated by the analyzer. Second Seat never sends it.</p>` +
    `<label>Draft reply text:<textarea id="draft-text" rows="4" cols="60"${dis(d === null)}>${d === null ? "" : esc(d.text)}</textarea></label>` +
    `<p id="draft-status">${esc(status)}</p>` +
    `<div><button type="button" id="btn-draft-approve"${dis(d === null)}>Approve draft</button>` +
    `<button type="button" id="btn-draft-reject"${dis(d === null)}>Reject</button>` +
    `<button type="button" id="btn-copy"${dis(!(d !== null && d.approved))}>Copy</button></div>` +
    `<p id="draft-note"></p></section>`;
}

export function sessionStateLabel(snap: SessionPageSnapshot): string {
  switch (snap.state) {
    case "input": return "Input — paste a transcript to begin.";
    case "redaction_pending": return "Redaction pending…";
    case "review_required": return "Review required — check the redacted preview, then approve.";
    case "approved": return "Approved — ready to analyze.";
    case "analysis_pending": return "Analysis pending…";
    case "completed": return "Completed — findings below.";
    case "blocked": return `Blocked — ${snap.reason ?? "a policy or approval check refused the request"}`;
    case "error": return snap.reason ? `Error — ${snap.reason}` : "Error — something went wrong.";
    default: return snap.state;
  }
}

export function verificationSectionHtml(
  verification: SessionPageSnapshot["verification"],
): string {
  if (verification === null || verification === undefined) {
    return `<section id="verification" hidden></section>`;
  }
  const items = verification.checks
    .map((check) => `<li data-check="${esc(check.id)}">${esc(check.label)}: ${esc(check.result)}</li>`)
    .join("");
  const message =
    verification.message === ""
      ? ""
      : `<p id="verification-message">${esc(verification.message)}</p>`;
  return `<section id="verification" data-status="${esc(verification.status)}" aria-label="${esc(verification.title)}">` +
    `<h2 id="verification-title">${esc(verification.title)}</h2>${message}<ul id="verification-checks">${items}</ul></section>`;
}

function sessionFindingsHtml(snap: SessionPageSnapshot): string {
  if (snap.state === "error") {
    const reason = snap.reason ?? "unknown reason";
    return `<p id="analysis-error" role="alert">Analysis failed: ${esc(reason)}. Results unavailable because the analysis could not be validated.</p>`;
  }
  if (snap.result === null) {
    return `<p id="empty-state">No findings yet — paste a transcript and run analysis.</p>`;
  }
  if (snap.result.entries.length === 0) {
    return `<p id="empty-state">No findings in the approved transcript.</p>`;
  }
  return snap.result.entries
    .map(
      (e, i) =>
        `<article class="result" id="result-${i}"><p>${esc(e.text)}</p>` +
        (e.flags && e.flags.length > 0 ? `<p class="flags">flags: ${e.flags.map(esc).join(", ")}</p>` : "") +
        `<p class="citations">${e.segmentIds.map((id) => `<a href="#${esc(id)}">[${esc(id)}]</a>`).join(" ")}</p></article>`,
    )
    .join("\n");
}

function sessionSupersededHtml(snap: SessionPageSnapshot): string {
  if (snap.superseded === null || snap.superseded === undefined) {
    return `<p id="superseded-notice" hidden></p>`;
  }
  return `<p id="superseded-notice">An earlier approved text was sent to the analyzer before your edit; its result was discarded. ${esc(snap.superseded.approvedText)}</p>`;
}

export function payloadStatusLabel(
  payload: { status: string; sentAt?: string; adapterLabel?: string } | null,
): string {
  if (payload === null) return "Not prepared yet";
  if (payload.status === "invoked") {
    return `Transport invoked at ${payload.sentAt ?? "unknown time"} — outcome pending`;
  }
  if (payload.status === "dispatched") {
    return `Dispatched to ${payload.adapterLabel ?? "analyzer"} at ${payload.sentAt ?? "unknown time"}`;
  }
  if (payload.status === "failed") {
    return `Dispatch attempted at ${payload.sentAt ?? "unknown time"} — failed or unknown outcome`;
  }
  return "Prepared (not dispatched)";
}

function sessionPayloadHtml(snap: SessionPageSnapshot): string {
  const text = snap.payload === null ? "" : snap.payload.approvedText;
  return `<pre id="payload-text">${esc(text)}</pre><p id="payload-status">${esc(payloadStatusLabel(snap.payload))}</p>${sessionSupersededHtml(snap)}`;
}

/** How the session page was opened: analysis mode and whether Live is configured. */
export type SessionPageView = {
  mode?: "offline" | "live";
  liveAvailable?: boolean;
  liveRequestedButUnavailable?: boolean;
  /** URL of the optional AI-self image; null/undefined shows the initials placeholder. */
  aiSelfSrc?: string | null;
};

const DEMO_STEPS: readonly [string, string][] = [
  ["paste", "Paste"],
  ["redact", "Redact"],
  ["approve", "You approve the redacted text"],
  ["analyze", "Analyze"],
  ["draft", "You approve the draft"],
  ["copy", "Copy"],
];

/** Loading-state labels for the two slow calls, by analysis mode. Live labels
 * name the real backends; Offline labels never claim a GPU or a model call. */
export const PROGRESS_LABELS: Readonly<Record<"offline" | "live", { redact: string; analyze: string; redactHint: string; analyzeHint: string }>> = {
  live: {
    redact: "Redacting on Meta Glimmer (GPU)\u2026",
    analyze: "Writing brief with Meta Muse Spark\u2026",
    redactHint: "Private GPU on Modal \u00b7 usually ~12 s when warm",
    analyzeHint: "Approved redacted text only \u00b7 usually ~13\u201320 s",
  },
  offline: {
    redact: "Redacting locally (offline demo)\u2026",
    analyze: "Writing brief (offline demo, recorded fixture)\u2026",
    redactHint: "Offline demo \u00b7 no model call",
    analyzeHint: "Offline demo \u00b7 no model call",
  },
};

function sessionProgressHtml(view: SessionPageView): string {
  return `<div id="progress" role="status" aria-live="polite" data-mode="${view.mode === "live" ? "live" : "offline"}" hidden>` +
    `<span class="spinner" aria-hidden="true"></span>` +
    `<span><span id="progress-label"></span> <span id="progress-elapsed" aria-hidden="true"></span><br><span id="progress-hint"></span></span>` +
    `<span id="progress-bar" aria-hidden="true"><span></span></span></div>`;
}

function sessionHeaderHtml(snap: SessionPageSnapshot, view: SessionPageView): string {
  const mode = view.mode ?? "offline";
  const live = view.liveAvailable === true;
  const cur = (m: string): string => (m === mode ? ' aria-current="true" class="active"' : "");
  const liveAttrs = live ? cur("live") : ' aria-disabled="true" class="unavailable"';
  const note =
    mode === "live"
      ? `<p id="live-label">Live — raw text goes only to the private Glimmer redactor; Spark sees only the text you approve.</p>`
      : view.liveRequestedButUnavailable === true
        ? `<p id="live-unavailable" role="alert">Live is not configured on this server. Start it with SECOND_SEAT_MODE=live, GLIMMER_BASE_URL and META_API_KEY to use Live. Showing Offline.</p>`
        : "";
  const steps = DEMO_STEPS.map(([id, label], i) => `<li data-step="${id}">${i + 1}. ${esc(label)}</li>`).join("");
  return `<header id="app-header">` +
    `<div class="brand"><span class="brand-mark" aria-hidden="true"></span><span class="brand-text"><strong>Second Seat</strong><span class="tagline">Redact privately. Brief with citations. You approve every step.</span></span></div>` +
    `<nav id="mode-select" aria-label="Analysis mode"><span class="mode-title">Mode</span>` +
    `<a id="mode-offline" href="/session"${cur("offline")}>Offline</a>` +
    `<a id="mode-live" href="/session?mode=live"${liveAttrs}>Live (Glimmer + Spark)</a></nav>` +
    `<label id="demo-mode-toggle" title="Demo Mode streamlines the screen for recording; approvals stay on"><input type="checkbox" id="demo-mode" role="switch" aria-describedby="demo-mode-note"> <span class="demo-mode-text">Demo Mode</span> <span id="demo-mode-state" aria-hidden="true">OFF</span></label>` +
    `</header>` +
    note +
    `<p id="demo-mode-note" hidden><strong>Demo Mode is on.</strong> Demo Mode streamlines the screen for recording. Owner approval is unchanged: you still approve the redacted text and the draft yourself.</p>` +
    `<ol id="steps" aria-label="Steps" hidden>${steps}</ol>`;
}

export function renderSessionPage(snap: SessionPageSnapshot, view: SessionPageView = {}): string {
  const canRedact = snap.state !== "redaction_pending" && snap.state !== "analysis_pending";
  const dis = (off: boolean): string => (off ? " disabled" : "");
  const segmentHtml = snap.segments
    .map((s) => `<li id="${esc(s.id)}">${esc(s.text)}</li>`)
    .join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Session — Second Seat</title>
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
#btn-redact,#btn-approve,#btn-analyze,#btn-draft-approve,#btn-copy{background:#1f4fd1;border-color:#1f4fd1;color:#fff;font-weight:600;padding:.6rem 1.3rem}
#btn-approve,#btn-draft-approve{background:#0f7a4a;border-color:#0f7a4a}
#app-header{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.75rem;padding:.75rem 0;border-bottom:1px solid #ddd;margin-bottom:1rem}
#app-header .brand{display:flex;flex-direction:column}
#app-header .brand strong{font-size:1.25rem}
.tagline{color:#555;font-size:.9rem}
#mode-select{display:flex;align-items:center;gap:.25rem}
.mode-title{color:#555;font-size:.85rem;margin-right:.25rem}
#mode-select a{padding:.35rem .8rem;border:1px solid #c8c8c8;border-radius:999px;text-decoration:none;color:#1a1a1a;background:#fff}
#mode-select a.active{background:#1a1a1a;color:#fff;border-color:#1a1a1a}
#mode-select a.unavailable{color:#888;border-style:dashed}
#demo-mode-toggle{display:inline-flex;align-items:center;gap:.45rem;font-weight:700;font-size:1.05rem;padding:.45rem .95rem;border:2px solid #1f4fd1;border-radius:999px;background:#fff;color:#1f4fd1;cursor:pointer;user-select:none}
#demo-mode-toggle input{width:1.25rem;height:1.25rem;accent-color:#0f7a4a;margin:0;cursor:pointer}
#demo-mode-state{font-size:.75rem;letter-spacing:.06em;padding:.1rem .45rem;border-radius:999px;background:#eceff3;color:#555}
body.demo #demo-mode-toggle{border-color:#0f7a4a;background:#0f7a4a;color:#fff}
body.demo #demo-mode-state{background:#fff;color:#0f7a4a}
#demo-mode-note{margin:0 0 .75rem;padding:.5rem .8rem;border-left:4px solid #0f7a4a;background:#e9f5ee;border-radius:0 .5rem .5rem 0;color:#0f4a2e}
#progress{display:flex;align-items:center;gap:.75rem;margin:0 0 1rem;padding:.8rem 1rem;border:1px solid #c9d6f5;border-radius:.75rem;background:#eef3ff;color:#16307a;font-weight:600}
#progress[hidden]{display:none}
#progress .spinner{flex:none;width:1.4rem;height:1.4rem;border:3px solid #c9d6f5;border-top-color:#1f4fd1;border-radius:50%;animation:ss-spin .8s linear infinite}
#progress-elapsed{font-variant-numeric:tabular-nums;font-weight:400;color:#33405a}
#progress-hint{font-weight:400;font-size:.85rem;color:#4a5a80}
#progress-bar{flex:1;min-width:6rem;height:.35rem;border-radius:999px;background:#d6e0f7;overflow:hidden}
#progress-bar span{display:block;height:100%;width:40%;border-radius:999px;background:#1f4fd1;animation:ss-slide 1.4s ease-in-out infinite}
@keyframes ss-spin{to{transform:rotate(360deg)}}
@keyframes ss-slide{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}
@media (prefers-reduced-motion:reduce){#progress .spinner,#progress-bar span{animation:none}}
#offline-label,#live-label{display:inline-block;padding:.2rem .7rem;border-radius:999px;font-size:.85rem;font-weight:600}
#offline-label{background:#eef1f6;color:#33405a}
#live-label{background:#fff4e0;color:#7a4b00}
#steps{display:flex;flex-wrap:wrap;gap:.4rem;list-style:none;padding:0;margin:0 0 1rem}
#steps li{padding:.3rem .7rem;border-radius:999px;background:#eceff3;color:#555;font-size:.9rem}
#steps li.done{background:#dff3e8;color:#0f5a37}
#steps li.current{background:#1f4fd1;color:#fff;font-weight:600}
body.demo #payload-panel{display:none}
body.demo #btn-approve,body.demo #btn-draft-approve{box-shadow:0 0 0 3px #bfe6d1}
body.demo #btn-redact,body.demo #btn-approve,body.demo #btn-analyze,body.demo #btn-draft-approve,body.demo #btn-copy{font-size:1.1rem;padding:.75rem 1.6rem}
${THEME_CSS}</style>
</head>
<body>
${sessionHeaderHtml(snap, view)}
<div class="ss-shell">
<main class="ss-main">
<h1>Vendor brief — session</h1>
${snap.offline ? `<p id="offline-label">Offline demo</p>` : ""}
<p id="session-state" role="status">${esc(sessionStateLabel(snap))}</p>
${sessionProgressHtml(view)}
<section id="input-section" aria-label="Transcript input">
<h2>Transcript</h2>
<label>Paste transcript:<textarea id="transcript-input" rows="4" cols="60"></textarea></label>
<div><button type="button" id="btn-redact"${dis(!canRedact)}>Redact</button></div>
<label>Redacted preview (editable):<textarea id="redacted-text" rows="4" cols="60">${esc(snap.redactedText)}</textarea></label>
<div><button type="button" id="btn-approve"${dis(snap.state !== "review_required")}>Approve</button>
<button type="button" id="btn-analyze"${dis(snap.state !== "approved" && snap.state !== "completed")}>Analyze</button></div>
</section>
<section id="findings" aria-label="Findings"><h2>Findings</h2>${verificationSectionHtml(snap.verification)}<div id="results">${sessionFindingsHtml(snap)}</div></section>
${sessionPressureHtml(snap)}
<section id="transcript" aria-label="Approved transcript"><h2>Approved transcript segments</h2><ol id="segments">${segmentHtml}</ol></section>
${sessionDraftHtml(snap)}
<section id="payload-panel" aria-label="Payload"><h2>Payload</h2>${sessionPayloadHtml(snap)}</section>
</main>
${twinStageHtml({ imageSrc: view.aiSelfSrc ?? null, modeLabel: view.mode === "live" ? "Live" : "Offline demo", narrowPlacement: "before" })}
</div>
<footer>Second Seat never sends a reply to the vendor.</footer>
<script>
(function(){
var sessionId=null,pending=false,lastRedacted="",lastDraft="",dirty=false,seq=0,editedSince=false,draftEdited=false,pollTimer=null;
var serverRev=${snap.revision ?? 0},serverAssessment=null,invSeq=0;
var input=document.getElementById("transcript-input"),redacted=document.getElementById("redacted-text");
var btnRedact=document.getElementById("btn-redact"),btnApprove=document.getElementById("btn-approve"),btnAnalyze=document.getElementById("btn-analyze");
var stateEl=document.getElementById("session-state"),resultsEl=document.getElementById("results");
var segmentsEl=document.getElementById("segments"),payloadText=document.getElementById("payload-text"),payloadStatus=document.getElementById("payload-status");
var offlineLabel=document.getElementById("offline-label");
var supersededEl=document.getElementById("superseded-notice");
var draftSection=document.getElementById("draft"),draftText=document.getElementById("draft-text");
var draftStatus=document.getElementById("draft-status"),draftNote=document.getElementById("draft-note");
var btnDraftApprove=document.getElementById("btn-draft-approve"),btnDraftReject=document.getElementById("btn-draft-reject"),btnCopy=document.getElementById("btn-copy");
var PAGE_MODE=${JSON.stringify(view.mode ?? "offline")};
var demoBox=document.getElementById("demo-mode"),stepsEl=document.getElementById("steps"),demoNote=document.getElementById("demo-mode-note");
var demoState=document.getElementById("demo-mode-state");
var PROGRESS=${JSON.stringify(PROGRESS_LABELS[view.mode === "live" ? "live" : "offline"])};
var progEl=document.getElementById("progress"),progLabel=document.getElementById("progress-label"),progElapsed=document.getElementById("progress-elapsed"),progHint=document.getElementById("progress-hint"),progKind=null,progT0=0,progTimer=null;
function progTick(){if(progElapsed)progElapsed.textContent=Math.floor((Date.now()-progT0)/1000)+" s";}
function showProgress(kind){if(!progEl)return;if(progKind!==kind){progKind=kind;progT0=Date.now();progLabel.textContent=PROGRESS[kind];progHint.textContent=PROGRESS[kind+"Hint"];progEl.setAttribute("data-kind",kind);}progEl.hidden=false;progTick();if(progTimer===null)progTimer=setInterval(progTick,250);}
function hideProgress(){progKind=null;if(progTimer!==null){clearInterval(progTimer);progTimer=null;}if(progEl){progEl.hidden=true;progEl.removeAttribute("data-kind");}}
function syncProgress(s){if(s.state==="redaction_pending")showProgress("redact");else if(s.state==="analysis_pending")showProgress("analyze");else if(!pending)hideProgress();}
function setDemo(on){document.body.classList.toggle("demo",on);if(demoState)demoState.textContent=on?"ON":"OFF";if(stepsEl)stepsEl.hidden=!on;if(demoNote)demoNote.hidden=!on;if(demoBox)demoBox.checked=on;try{localStorage.setItem("secondSeatDemo",on?"1":"0");}catch(e){}}
function stepFor(s){var d=s.draft||null;if(d&&d.approved)return 5;if(d)return 4;switch(s.state){case "redaction_pending":return 1;case "review_required":return 2;case "approved":return 3;case "analysis_pending":return 3;case "completed":return 4;default:return input&&input.value.trim()?1:0;}}
function syncSteps(s){if(!stepsEl)return;var k=stepFor(s),items=stepsEl.getElementsByTagName("li");for(var i=0;i<items.length;i++){items[i].className=i<k?"done":(i===k?"current":"");}}
if(demoBox){demoBox.addEventListener("change",function(){setDemo(demoBox.checked);});}
(function(){var on=false;try{on=/[?&]demo=1(&|$)/.test(location.search)||localStorage.getItem("secondSeatDemo")==="1";}catch(e){}setDemo(on);})();
var LABELS={"input":"Input — paste a transcript to begin.","redaction_pending":"Redaction pending…","review_required":"Review required — check the redacted preview, then approve.","approved":"Approved — ready to analyze.","analysis_pending":"Analysis pending…","completed":"Completed — findings below."};
function labelFor(s){if(s.state==="blocked")return "Blocked — "+(s.reason||"a policy or approval check refused the request");if(s.state==="error")return s.reason?("Error — "+s.reason):"Error — something went wrong.";return LABELS[s.state]||s.state;}
function el(tag,attrs,text){var n=document.createElement(tag);for(var k in attrs){n.setAttribute(k,attrs[k]);}if(text!==undefined)n.textContent=text;return n;}
function revOf(s){return (s&&typeof s.revision==="number")?s.revision:null;}
function render(s){
  var rev=revOf(s);
  if(rev!==null){if(rev<serverRev)return false;serverRev=rev;}
  if(s.pressure&&typeof s.pressure.assessmentId==="string")serverAssessment=s.pressure.assessmentId;
  stateEl.textContent=labelFor(s);
  syncSteps(s);
  syncProgress(s);
  if(offlineLabel)offlineLabel.hidden=!s.offline;
  var serverPreview=s.redactedText||"";
  if(redacted.value===lastRedacted||redacted.value===serverPreview){redacted.value=serverPreview;lastRedacted=serverPreview;}
  var canRedact=s.state!=="redaction_pending"&&s.state!=="analysis_pending";
  btnRedact.disabled=pending||!canRedact||!input.value.trim();
  btnApprove.disabled=pending||s.state!=="review_required";
  btnAnalyze.disabled=pending||(s.state!=="approved"&&s.state!=="completed");
  while(segmentsEl.firstChild)segmentsEl.removeChild(segmentsEl.firstChild);
  (s.segments||[]).forEach(function(g){segmentsEl.appendChild(el("li",{id:g.id},g.text));});
  var verEl=document.getElementById("verification");
  if(verEl){
    while(verEl.firstChild)verEl.removeChild(verEl.firstChild);
    var v=s.verification;
    if(!v){verEl.hidden=true;verEl.removeAttribute("data-status");}
    else{
      verEl.hidden=false;
      verEl.setAttribute("data-status",v.status||"");
      verEl.appendChild(el("h2",{id:"verification-title"},v.title||""));
      if(v.message)verEl.appendChild(el("p",{id:"verification-message"},v.message));
      var list=el("ul",{id:"verification-checks"});
      (v.checks||[]).forEach(function(c){list.appendChild(el("li",{"data-check":c.id},c.label+": "+c.result));});
      verEl.appendChild(list);
    }
  }
  while(resultsEl.firstChild)resultsEl.removeChild(resultsEl.firstChild);
  if(s.state==="error"){resultsEl.appendChild(el("p",{id:"analysis-error",role:"alert"},"Analysis failed: "+(s.reason||"unknown reason")+". Results unavailable because the analysis could not be validated."));}
  else if(!s.result){resultsEl.appendChild(el("p",{id:"empty-state"},"No findings yet — paste a transcript and run analysis."));}
  else if(s.result.entries.length===0){resultsEl.appendChild(el("p",{id:"empty-state"},"No findings in the approved transcript."));}
  else{s.result.entries.forEach(function(e,i){
    var a=el("article",{"class":"result",id:"result-"+i});
    a.appendChild(el("p",{},e.text));
    if(e.flags&&e.flags.length){a.appendChild(el("p",{"class":"flags"},"flags: "+e.flags.join(", ")));}
    var c=el("p",{"class":"citations"});
    (e.segmentIds||[]).forEach(function(id){var link=el("a",{href:"#"+id},"["+id+"]");c.appendChild(link);c.appendChild(document.createTextNode(" "));});
    a.appendChild(c);resultsEl.appendChild(a);});}
  if(!s.payload){payloadText.textContent="";payloadStatus.textContent=(lastRedacted&&redacted.value!==lastRedacted)?"Not prepared — preview edited, approve again":"Not prepared yet";}
  else{payloadText.textContent=s.payload.approvedText;var pst=s.payload.status;
  if(pst==="invoked")payloadStatus.textContent="Transport invoked at "+(s.payload.sentAt||"unknown time")+" — outcome pending";
  else if(pst==="dispatched")payloadStatus.textContent="Dispatched to "+(s.payload.adapterLabel||"analyzer")+" at "+(s.payload.sentAt||"unknown time");
  else if(pst==="failed")payloadStatus.textContent="Dispatch attempted at "+(s.payload.sentAt||"unknown time")+" — failed or unknown outcome";
  else payloadStatus.textContent="Prepared (not dispatched)";}
  syncPressure(s);
  var d=s.draft||null;
  serverDraftApproved=!!(d&&d.approved);
  if(serverDraftApproved){draftRejectSent=false;}
  if(draftSection)draftSection.hidden=!d;
  if(d){
    var serverDraft=d.text||"";
    if(draftText.value===lastDraft||draftText.value===serverDraft){draftText.value=serverDraft;lastDraft=serverDraft;}
    draftText.disabled=false;
    var localMatches=draftText.value===serverDraft;
    var approvedNow=!!d.approved&&localMatches&&!draftEdited;
    var draftSyncPending=draftDeb!==null;
    draftStatus.textContent=!localMatches?"Edited — approve again":(d.approved&&!draftEdited?"Approved — ready to copy.":(draftEdited&&draftSyncPending?"Edited — approve again":"Review — approve to copy."));
    btnDraftApprove.disabled=pending||false;
    btnDraftReject.disabled=pending||false;
    var previewClean=redacted.value===lastRedacted;
    btnCopy.disabled=pending||!approvedNow||editedSince||!pressureOk(s)||!previewClean;
  }else{
    if(draftText.value===lastDraft){draftText.value="";lastDraft="";}
    draftText.disabled=true;
    draftStatus.textContent="No draft yet — analyze first.";
    btnDraftApprove.disabled=true;btnDraftReject.disabled=true;btnCopy.disabled=true;
  }
  if(supersededEl){
    if(s.superseded){supersededEl.hidden=false;supersededEl.textContent="An earlier approved text was sent to the analyzer before your edit; its result was discarded. "+s.superseded.approvedText;}
    else{supersededEl.hidden=true;supersededEl.textContent="";}
  }
  return true;
}
function call(path,body){return fetch(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}).then(function(r){return r.json().then(function(b){return {ok:r.ok,status:r.status,body:b};});});}
function applySnapshot(s){
  if(!s||typeof s!=="object")return refresh();
  var rev=revOf(s);
  if(rev!==null&&rev<serverRev)return refresh();
  editedSince=false;
  render(s);
}
function applyResult(r){
  if(!r)return refresh();
  if(r.ok){applySnapshot(r.body);return;}
  if(r.body&&r.body.state){applySnapshot(r.body.state);return;}
  refresh();
}
/* Versioned mutation: names the exact revision reviewed. Never overwrites
   local edits made after the request was issued (see render). Superseding
   intents (invalidate, draft text) rebase once after a 409; review intents
   (approvals, pressure) never retry — a stale review must stay rejected. */
function mut(path,fields,opts){
  opts=opts||{};
  if(!sessionId)return Promise.resolve({ok:false,status:0,body:null});
  var payload={sessionId:sessionId};
  for(var k in fields){payload[k]=fields[k];}
  payload.expectedRevision=serverRev;
  return call(path,payload).then(function(r){
    if(r.ok){applySnapshot(r.body);return r;}
    if(r.status===409&&r.body&&r.body.state){
      applySnapshot(r.body.state);
      if(opts.rebase&&!opts.retried){opts.retried=true;return mut(path,fields,opts);}
    }
    return r;
  });
}
function pressureOk(s){var p=s.pressure||null;if(!p)return true;if(p.status==="valid_negative")return true;if(p.status==="valid_positive")return !!p.allReviewed;if(p.status==="not_run"||p.status==="failed")return false;if(!p.items||p.items.length===0)return true;return !!p.allReviewed;}
function pressureLabel(p){if(p&&p.status==="not_run")return "not run";if(p&&p.status==="failed")return "failed / unavailable";var source=p?p.source:"";if(source==="offline-fixture")return "offline fixture";if(source==="live")return "live check";if(source==="pattern")return "deterministic pattern detection";if(source==="none")return "not run";return "deterministic pattern detection";}
function syncPressure(s){
  var old=document.getElementById("pressure");
  if(old&&old.parentNode)old.parentNode.removeChild(old);
  var p=s.pressure||null;
  if(!p)return;
  var empty=!p.items||p.items.length===0;
  var findings=document.getElementById("findings");
  if(!findings||!findings.parentNode)return;
  var sec=el("section",{id:"pressure","aria-label":"Possible pressure"});
  sec.appendChild(el("h2",{},"Possible pressure — assessment, not a judgment of anyone's intent"));
  sec.appendChild(el("p",{id:"pressure-source"},pressureLabel(p)));
  if(empty){
    if(p.status==="valid_negative")sec.appendChild(el("p",{id:"pressure-negative"},"No pressure items found"));
    else if(p.status!=="not_run"&&p.status!=="failed")return;
    return findings.parentNode.insertBefore(sec,findings.nextSibling);
  }
  p.items.forEach(function(item){
    var art=el("article",{"class":"pressure-item",id:"pressure-"+item.id});
    art.appendChild(el("a",{"class":"pressure-badge",href:"#"+item.segmentId},"pressure: "+item.id));
    art.appendChild(el("p",{"class":"pressure-quote"},item.quote));
    art.appendChild(el("p",{"class":"pressure-tactic"},"tactic: "+item.tactic));
    art.appendChild(el("p",{"class":"pressure-term"},"unresolved term: "+((item.unresolvedTerm===""||item.unresolvedTerm===undefined)?"term not identified":item.unresolvedTerm)));
    var lab=document.createElement("label");lab.setAttribute("class","pressure-check");
    var box=document.createElement("input");box.setAttribute("type","checkbox");box.setAttribute("class","pressure-review");box.setAttribute("data-pressure",item.id);
    if(p.reviewed&&p.reviewed.indexOf(item.id)>=0)box.checked=true;
    (function(id,checkbox){
      checkbox.addEventListener("change",function(){
        if(!sessionId)return;
        if(checkbox.checked){
          run(mut("/api/session/pressure-review",{itemId:id,assessmentId:serverAssessment},{}));
        }else{
          if(btnCopy)btnCopy.disabled=true;
          run(mut("/api/session/pressure-review",{itemId:id,assessmentId:serverAssessment,reviewed:false},{}));
        }
      });
    })(item.id,box);
    lab.appendChild(box);lab.appendChild(document.createTextNode(" Reviewed"));
    art.appendChild(lab);sec.appendChild(art);
  });
  findings.parentNode.insertBefore(sec,findings.nextSibling);
}
function refresh(){if(!sessionId)return;pending=true;updateButtons();var my=++seq;fetch("/api/session/state?sessionId="+encodeURIComponent(sessionId)).then(function(r){return r.json();}).then(function(s){pending=false;if(my!==seq)return;editedSince=false;render(s);}).catch(function(){pending=false;updateButtons();});}
function updateButtons(){btnRedact.disabled=true;btnApprove.disabled=true;btnAnalyze.disabled=true;if(btnDraftApprove)btnDraftApprove.disabled=true;if(btnDraftReject)btnDraftReject.disabled=true;if(btnCopy)btnCopy.disabled=true;}
function run(promise){pending=true;updateButtons();var my=++seq;return promise.then(function(r){pending=false;if(my!==seq){refresh();return r;}applyResult(r);return r;}).catch(function(){pending=false;if(my!==seq){refresh();return;}refresh();});}
function stopPoll(){if(pollTimer!==null){clearInterval(pollTimer);pollTimer=null;}}
function startPoll(){
  stopPoll();
  pollTimer=setInterval(function(){
    if(!sessionId)return;
    var my=seq;
    fetch("/api/session/state?sessionId="+encodeURIComponent(sessionId)).then(function(r){return r.json();}).then(function(s){
      if(my!==seq)return;
      var rev=revOf(s);
      if(rev!==null&&rev<serverRev)return;
      render(s);
    }).catch(function(){});
  },250);
}
function invalidateLocal(scope){
  editedSince=true;
  draftEdited=false;
  stopPoll();
  seq++;
  invSeq++;
  var po=document.getElementById("pressure");if(po&&po.parentNode)po.parentNode.removeChild(po);
  while(resultsEl.firstChild)resultsEl.removeChild(resultsEl.firstChild);
  resultsEl.appendChild(el("p",{id:"empty-state"},"No findings yet — paste a transcript and run analysis."));
  clearDraftLocal();
  btnAnalyze.disabled=true;
  if(scope==="transcript"){
    btnApprove.disabled=true;
    redacted.value="";
    payloadText.textContent="";payloadStatus.textContent="Not prepared yet";
  }else{
    payloadStatus.textContent="Not prepared — preview edited, approve again";
  }
  if(!sessionId)return;
  run(mut("/api/session/invalidate",{scope:scope},{rebase:true}));
}
function clearLocalResults(){while(resultsEl.firstChild)resultsEl.removeChild(resultsEl.firstChild);resultsEl.appendChild(el("p",{id:"empty-state"},"No findings yet — paste a transcript and run analysis."));}
var deb=null;
function clearDraftLocal(){
  if(draftSection)draftSection.hidden=true;
  if(draftText){draftText.value="";draftText.disabled=true;lastDraft="";}
  if(draftStatus)draftStatus.textContent="No draft yet — analyze first.";
  if(btnDraftApprove)btnDraftApprove.disabled=true;
  if(btnDraftReject)btnDraftReject.disabled=true;
  if(btnCopy)btnCopy.disabled=true;
}
input.addEventListener("input",function(){
  dirty=true;
  invalidateLocal("transcript");
  btnRedact.disabled=pending||!input.value.trim();
  if(deb)clearTimeout(deb);
  var v=input.value;
  deb=setTimeout(function(){if(!sessionId)return;dirty=false;run(call("/api/session/transcript",{sessionId:sessionId,text:v}));},300);
});
redacted.addEventListener("input",function(){
  invalidateLocal("preview");
});
btnRedact.addEventListener("click",function(){if(btnRedact.disabled||!sessionId)return;if(deb){clearTimeout(deb);deb=null;}dirty=false;pending=true;updateButtons();showProgress("redact");run(call("/api/session/transcript",{sessionId:sessionId,text:input.value}).then(function(t){if(!t.ok)return t;return call("/api/session/redact",{sessionId:sessionId});})).then(hideProgress,hideProgress);});
/* corrections are sent with Approve (avoids blur/click race); the chained
   approve is skipped when the preview changed — or was invalidated — after the click */
btnApprove.addEventListener("click",function(){
  if(btnApprove.disabled||!sessionId)return;
  var basis=redacted.value,mark=invSeq;
  pending=true;updateButtons();
  if(basis===lastRedacted){run(mut("/api/session/approve",{},{}));return;}
  run(mut("/api/session/correct",{text:basis},{}).then(function(c){
    if(!c.ok)return c;
    if(redacted.value!==basis||invSeq!==mark)return c;
    return mut("/api/session/approve",{},{});
  }));
});
btnAnalyze.addEventListener("click",function(){if(btnAnalyze.disabled)return;if(dirty)return;if(redacted.value!==lastRedacted)return;stateEl.textContent=LABELS["analysis_pending"];showProgress("analyze");startPoll();run(call("/api/session/analyze",{sessionId:sessionId})).then(function(){stopPoll();hideProgress();},function(){stopPoll();hideProgress();});});
var draftDeb=null,draftGen=0,serverDraftApproved=false,draftApproveInflight=false,draftRejectSent=false;
draftText.addEventListener("input",function(){
  draftGen++;
  draftEdited=true;
  seq++;
  btnCopy.disabled=true;
  draftStatus.textContent="Edited — approve again";
  if(serverDraftApproved||draftApproveInflight){
    if(!draftRejectSent){draftRejectSent=true;run(mut("/api/session/draft/reject",{},{rebase:true}));}
  }
  if(draftDeb)clearTimeout(draftDeb);
  var g=draftGen;
  draftDeb=setTimeout(function(){draftDeb=null;if(!sessionId)return;if(g!==draftGen)return;run(mut("/api/session/draft",{text:draftText.value},{rebase:true}));},300);
});
btnDraftApprove.addEventListener("click",function(){if(btnDraftApprove.disabled||!sessionId)return;if(draftDeb){clearTimeout(draftDeb);draftDeb=null;}var t=draftText.value,g=draftGen;draftApproveInflight=true;draftRejectSent=false;pending=true;updateButtons();run(mut("/api/session/draft",{text:t},{rebase:true}).then(function(e){if(!e.ok)return e;if(draftText.value!==t||g!==draftGen)return e;draftEdited=false;return mut("/api/session/draft/approve",{text:t},{}).then(function(a){if(!a.ok)return a;if(draftText.value!==t||g!==draftGen)return a;draftEdited=false;return a;});}).then(function(r){draftApproveInflight=false;return r;},function(err){draftApproveInflight=false;throw err;}));});
btnDraftReject.addEventListener("click",function(){if(btnDraftReject.disabled||!sessionId)return;if(draftDeb){clearTimeout(draftDeb);draftDeb=null;}draftGen++;draftEdited=false;run(mut("/api/session/draft/reject",{},{}));});
btnCopy.addEventListener("click",function(){if(btnCopy.disabled)return;var text=draftText.value;function done(){draftNote.textContent="Copied locally. Nothing was sent.";}function fallback(){var t=document.createElement("textarea");t.value=text;document.body.appendChild(t);t.select();try{document.execCommand("copy");}catch(e){}document.body.removeChild(t);done();}if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(done,function(){fallback();});}else{fallback();}});
fetch("/api/session",{method:"POST",headers:{"content-type":"application/json"},body:PAGE_MODE==="live"?JSON.stringify({mode:"live"}):"{}"}).then(function(r){return r.json();}).then(function(b){sessionId=b.sessionId;refresh();});
})();
</script>
</body>
</html>`;
}
