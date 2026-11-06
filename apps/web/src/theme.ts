// Clean UI theme + "AI Twin of Bridgett" stage panel.
//
// Written fresh during the hackathon (Oct 28, 2026). The look — soft
// purple/pink palette, rounded soft-shadow cards, pill badges, a header bar
// and a twin stage beside the brief — is inspired by Bridgett's earlier
// prototype, but no code from it is reused here. Plain CSS + HTML strings,
// no framework, no web fonts, no network requests.
import { existsSync } from "node:fs";
import { join } from "node:path";

/** Public URL + on-disk file for the optional AI-self image. */
export interface AiSelfAsset {
  /** URL path the page uses, e.g. "/ai-self.png". */
  url: string;
  /** Absolute path on disk. */
  file: string;
  contentType: "image/png" | "image/jpeg";
}

const AI_SELF_CANDIDATES: readonly [string, AiSelfAsset["contentType"]][] = [
  ["ai-self.png", "image/png"],
  ["ai-self.jpg", "image/jpeg"],
];

/**
 * Finds apps/web/public/ai-self.(png|jpg). Returns null when neither exists,
 * so the stage shows the initials placeholder and the page never requests a
 * missing image (no 404, no console noise).
 */
export function findAiSelf(webRoot: string): AiSelfAsset | null {
  for (const [name, contentType] of AI_SELF_CANDIDATES) {
    const file = join(webRoot, "public", name);
    if (existsSync(file)) return { url: `/${name}`, file, contentType };
  }
  return null;
}

export interface TwinStageOpts {
  /** Image URL, or null/undefined for the "BS" initials placeholder. */
  imageSrc?: string | null;
  /** Short mode pill, e.g. "Offline demo", "Recorded replay", "Live". */
  modeLabel: string;
  /** "after" keeps the stage below the main column on narrow screens. */
  narrowPlacement?: "before" | "after";
  /** Optional caption override. */
  caption?: string;
}

function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export const MEETING_ROOM_TWIN_CAPTION = "Offline meeting room with made-up meetings. The twin drafts; you approve every step before anything moves.";

export function twinStageHtml(opts: TwinStageOpts): string {
  const visual = opts.imageSrc
    ? `<img id="twin-image" src="${escAttr(opts.imageSrc)}" alt="AI-generated likeness of Bridgett, her AI Twin" width="420" height="455" decoding="async">`
    : `<div id="twin-placeholder" role="img" aria-label="AI Twin placeholder with initials BS"><span aria-hidden="true">BS</span></div>`;
  const placement = opts.narrowPlacement === "after" ? "after" : "before";
  return `<aside id="twin-stage" aria-label="AI Twin of Bridgett" data-narrow="${placement}">` +
    `<div class="twin-frame">` +
    `<span class="twin-badge">AI Twin of Bridgett</span>` +
    visual +
    `<span id="twin-ai-label" class="twin-ai-label">AI-generated</span>` +
    `</div>` +
    `<div class="twin-body">` +
    `<p class="twin-title"><span class="twin-title-wide">Your second seat</span><span class="twin-title-narrow">AI Twin of Bridgett</span></p>` +
    `<p class="twin-caption">${escAttr(opts.caption ?? "Sits beside the brief and suggests. It never sends anything for you.")}</p>` +
    `<ul class="twin-pills">` +
    `<li class="pill pill-soft">${escAttr(opts.modeLabel)}</li>` +
    `<li class="pill pill-outline">You approve every step</li>` +
    `</ul>` +
    `</div>` +
    `</aside>`;
}

/** Header bar for the brief replay page (the session page has its own). */
export function briefAppBarHtml(): string {
  return `<header id="app-bar">` +
    `<div class="brand"><span class="brand-mark" aria-hidden="true"></span>` +
    `<span class="brand-text"><strong>Second Seat</strong><span class="brand-sub">by Loving Grace</span></span></div>` +
    `<span class="pill pill-soft" id="replay-pill">Recorded replay</span>` +
    `</header>`;
}

/**
 * Shared theme. Appended after each page's base styles so it only restyles;
 * every id the scripts and tests rely on is unchanged.
 */
export const THEME_CSS = `
:root{--ss-bg:#fbf8fd;--ss-ink:#2b2236;--ss-muted:#6e6480;--ss-line:#ece4f3;--ss-card:#fff;--ss-primary:#6a3fb3;--ss-primary-2:#8b4fc8;--ss-primary-ink:#fff;--ss-lav:#efe7fb;--ss-pink:#fbe6f0;--ss-rose:#c2477e;--ss-ok:#2f7d5b;--ss-ok-soft:#e5f4ec;--ss-radius:1rem;--ss-shadow:0 1px 2px rgba(64,32,96,.05),0 10px 28px -12px rgba(64,32,96,.18)}
body{font-family:"Inter","Segoe UI Variable","Segoe UI",system-ui,-apple-system,Roboto,Helvetica,Arial,sans-serif;max-width:78rem;padding:0 1.25rem 1.5rem;color:var(--ss-ink);background:var(--ss-bg) radial-gradient(60rem 26rem at 100% -10%,#f7e6f3 0,transparent 60%) no-repeat;-webkit-font-smoothing:antialiased}
h1{font-size:1.5rem;font-weight:700;letter-spacing:-.01em;margin:.1rem 0 .25rem}
h2{font-size:1.05rem;font-weight:650;letter-spacing:-.005em}
a{color:var(--ss-primary)}
section,#conflicts,#draft,.category,#flagged,#transcript,#frames,#hero-chain,#what-left-this-server,#scores{background:var(--ss-card);border:1px solid var(--ss-line);border-radius:var(--ss-radius);box-shadow:var(--ss-shadow)}
#hero,#hero-wrap{background:transparent;border:0;box-shadow:none}
#hero{padding:0}
textarea,select{font:inherit;border:1px solid var(--ss-line);border-radius:.75rem;padding:.55rem .7rem;background:#fff;color:var(--ss-ink)}
textarea:focus,select:focus{outline:2px solid #cdb5f0;outline-offset:1px;border-color:#cdb5f0}
button{border-radius:999px;border:1px solid var(--ss-line);background:#fff;color:var(--ss-ink);font-weight:600;cursor:pointer;transition:box-shadow .15s,transform .05s}
button:hover:not(:disabled){box-shadow:0 2px 10px -4px rgba(106,63,179,.45)}
button:active:not(:disabled){transform:translateY(1px)}
button:disabled{opacity:.45;cursor:not-allowed}
#btn-redact,#btn-analyze,#btn-copy{background:var(--ss-primary);border-color:var(--ss-primary);color:var(--ss-primary-ink)}
#btn-approve,#btn-draft-approve{background:linear-gradient(135deg,var(--ss-primary),var(--ss-primary-2));border-color:var(--ss-primary);color:var(--ss-primary-ink)}
footer{border-top:1px solid var(--ss-line);color:var(--ss-muted);font-size:.9rem}
.pill{display:inline-flex;align-items:center;gap:.3rem;border-radius:999px;padding:.2rem .7rem;font-size:.8rem;font-weight:600;line-height:1.4;white-space:nowrap}
.pill-soft{background:var(--ss-lav);color:#4b2a86}
.pill-outline{background:#fff;color:var(--ss-muted);border:1px solid var(--ss-line)}
.model-chip{border:1px solid var(--ss-line);background:#fff;color:var(--ss-muted);font-weight:500;font-size:.74rem;padding:0 .5rem;margin:.08rem}
#model-strip{margin:0 0 .15rem}
#hero #conflicts,#hero #draft,#hero #scores{padding:.8rem 1rem}
#hero h2{margin:0 0 .3rem}
#draft p{margin:.2rem 0}
#draft .pressure-check{font-size:.82rem;line-height:1.4;color:#463d55}
#draft-text{font-size:.92rem}
#hero #scores p{font-size:.85rem;margin:.15rem 0}
#draft button{padding:.35rem 1rem;margin:.2rem .2rem 0 0}
.replay-label{margin:0 0 .4rem;color:var(--ss-muted);font-size:.92rem}
#hero{margin:.5rem 0}
.model-chip[data-status="live"]{border-color:#bfe3cf;background:var(--ss-ok-soft);color:#1f5a3f}
.pressure-badge{background:var(--ss-pink);color:#8a2353;border-radius:999px;padding:.2rem .75rem;font-weight:600;font-size:.85rem}
#conflicts blockquote{border-left-color:var(--ss-rose);background:#fdf5f9}
#offline-label,#live-label{border-radius:999px}
#offline-label{background:var(--ss-lav);color:#4b2a86}
#steps[hidden]{display:none}
#steps li{background:#f2edf7;color:var(--ss-muted)}
#steps li.done{background:var(--ss-ok-soft);color:#1f5a3f}
#steps li.current{background:var(--ss-primary);color:#fff}
#progress{border-color:#dccbf3;background:#f5effd;color:#3f2470}
#progress .spinner{border-color:#dccbf3;border-top-color:var(--ss-primary)}
#progress-bar{background:#e6dbf6}
#progress-bar span{background:linear-gradient(90deg,var(--ss-primary),#d06aa0)}
#progress-hint,#progress-elapsed{color:#5b4a78}
#demo-mode-note{border-left-color:var(--ss-primary);background:var(--ss-lav);color:#3f2470}
#app-header,#app-bar{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.75rem;margin:0 -1.25rem .85rem;padding:.45rem 1.25rem;background:rgba(255,255,255,.82);backdrop-filter:saturate(1.4) blur(10px);-webkit-backdrop-filter:saturate(1.4) blur(10px);border-bottom:1px solid var(--ss-line)}
#app-header .brand,#app-bar .brand{display:flex;flex-direction:row;align-items:center;gap:.6rem}
.brand-mark{flex:none;width:2rem;height:2rem;border-radius:.65rem;background:linear-gradient(135deg,#8b5cd6,#e48bb8);box-shadow:inset 0 0 0 2px rgba(255,255,255,.35)}
.brand-text{display:flex;flex-direction:column;line-height:1.2}
.brand-text strong{font-size:1.05rem}
.brand-sub,.tagline{color:var(--ss-muted);font-size:.8rem}
#mode-select a{border-color:var(--ss-line);color:var(--ss-ink)}
#mode-select a.active{background:var(--ss-ink);border-color:var(--ss-ink);color:#fff}
#demo-mode-toggle{border-color:var(--ss-primary);color:var(--ss-primary);background:#fff;box-shadow:0 2px 10px -6px rgba(106,63,179,.6)}
#demo-mode-toggle input{accent-color:var(--ss-primary)}
#demo-mode-state{background:#f2edf7;color:var(--ss-muted)}
body.demo #demo-mode-toggle{border-color:var(--ss-primary);background:var(--ss-primary);color:#fff}
body.demo #demo-mode-state{background:#fff;color:var(--ss-primary)}
body.demo #btn-approve,body.demo #btn-draft-approve{box-shadow:0 0 0 3px #e2d3f7}
.ss-shell{display:grid;grid-template-columns:minmax(0,1fr) 16rem;gap:1.25rem;align-items:start}
.ss-main{min-width:0}
#twin-stage{position:sticky;top:4rem;background:var(--ss-card);border:1px solid var(--ss-line);border-radius:1.25rem;box-shadow:var(--ss-shadow);overflow:hidden}
.twin-frame{position:relative;aspect-ratio:420/455;background:linear-gradient(160deg,#efe4fb 0%,#f8e6f1 55%,#fdf1f6 100%);display:flex;align-items:flex-end;justify-content:center}
#twin-image{display:block;width:100%;height:100%;object-fit:cover;object-position:center top}
#twin-placeholder{align-self:center;width:8.5rem;height:8.5rem;border-radius:50%;display:flex;align-items:center;justify-content:center;background:linear-gradient(145deg,#fff 0%,#f3e9fc 100%);box-shadow:0 10px 30px -12px rgba(106,63,179,.45),inset 0 0 0 6px rgba(255,255,255,.7);color:#6a3fb3;font-size:2.4rem;font-weight:700;letter-spacing:.04em}
.twin-badge{position:absolute;top:.7rem;left:.7rem;z-index:1;border-radius:999px;padding:.25rem .7rem;font-size:.78rem;font-weight:650;background:rgba(43,34,54,.86);color:#fff}
.twin-ai-label{position:absolute;bottom:.7rem;right:.7rem;z-index:1;border-radius:999px;padding:.2rem .6rem;font-size:.72rem;font-weight:650;letter-spacing:.02em;white-space:nowrap;background:rgba(255,255,255,.92);color:#4b2a86;border:1px solid #e3d6f5}
.twin-body{padding:.85rem 1rem 1rem}
.twin-title{margin:0;font-weight:700}
.twin-title-narrow{display:none}
.twin-caption{margin:.2rem 0 .6rem;color:var(--ss-muted);font-size:.88rem}
.twin-pills{display:flex;flex-wrap:wrap;gap:.35rem;list-style:none;margin:0;padding:0}
@media (max-width:60rem){
.ss-shell{grid-template-columns:1fr}
#twin-stage{position:static;display:grid;grid-template-columns:7.5rem 1fr;align-items:center}
#twin-stage[data-narrow="before"]{order:-1}
.twin-title-wide{display:none}
.twin-title-narrow{display:inline}
.twin-frame{height:100%;aspect-ratio:auto;min-height:7rem}
#twin-placeholder{width:4.25rem;height:4.25rem;font-size:1.3rem}
.twin-badge{display:none}
.twin-ai-label{bottom:.4rem;right:auto;left:50%;transform:translateX(-50%);font-size:.62rem;padding:.1rem .45rem}
}
@media (prefers-reduced-motion:reduce){button{transition:none}}
`;
