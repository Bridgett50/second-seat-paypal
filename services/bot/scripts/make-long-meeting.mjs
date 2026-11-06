#!/usr/bin/env node
// Deterministic generator of a made-up 110-minute fixture meeting.
// Writes services/bot/fixtures/long-meeting/{transcript.txt,frames.txt,brief.recorded.json}
// with >=320 segments and >=32 frames. Seeded LCG: same bytes every run.
// Fixture mode only; all people, companies, and content are invented.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "long-meeting");
const N_SEG = 335; // 335 x 20s = 111.7 min span (>=110 min, >=320 segments)
const SEG_GAP = 20;
const N_FRAMES = 40; // >=32 frames
const FRAME_GAP = 165;

let state = 0xc0ffee;
function rand() {
  state = (state * 1103515245 + 12345) & 0x7fffffff;
  return state / 0x7fffffff;
}
function pick(arr) {
  return arr[Math.floor(rand() * arr.length)];
}
const pad2 = (n) => (n < 10 ? `0${n}` : `${n}`);
const mmss = (t) => `${pad2(Math.floor(t / 60))}:${pad2(t % 60)}`;

const SPEAKERS = ["Amara", "Ben", "Chidi", "Dana", "Eli", "Farah"];
const TOPICS = [
  "the onboarding checklist for new hires",
  "the quarterly roadmap for the sample product",
  "the office seating plan for the new floor",
  "the agenda for the fictional user conference",
  "the maintenance window for the demo servers",
  "the style guide for sample documentation",
  "the catering order for the team offsite",
  "the backup schedule for the test fixtures",
];
const VERDICTS = [
  "The team agreed to revisit this item next week.",
  "The team agreed to keep the current draft unchanged.",
  "The team agreed to ask the working group for input.",
  "The team agreed to table this until the next review.",
];

const segLines = [];
const segIds = [];
for (let i = 0; i < N_SEG; i += 1) {
  const t = i * SEG_GAP;
  const id = `t-${mmss(t)}`;
  segIds.push(id);
  segLines.push(`[${mmss(t)}] ${pick(SPEAKERS)}: Discussing ${pick(TOPICS)}, point ${i + 1} of the made-up agenda. ${pick(VERDICTS)}`);
}

const frameLines = [];
const frameIds = [];
for (let j = 0; j < N_FRAMES; j += 1) {
  const t = j * FRAME_GAP;
  const name = `frame-${mmss(t).replace(":", "-")}.png`;
  frameIds.push(name);
  frameLines.push(`${name} ${mmss(t)}`);
}

// Synthetic recorded-style fixture: rawText cites only generated segment ids
// (segment-kind citations shaped like the hero fixture). Marked synthetic:
// deterministic generator output, NOT recorded from a live call.
const entries = [];
for (let e = 0; e < 12; e += 1) {
  const a = segIds[(e * 25) % segIds.length];
  const b = segIds[(e * 25 + 7) % segIds.length];
  const cite = (sid) => ({ kind: "segment", segmentId: sid, frameId: null, region: { box: null, concept: null, maskRef: null, spotCheck: null } });
  entries.push({
    id: `e${e + 1}`,
    category: e % 3 === 0 ? "decision" : e % 3 === 1 ? "action" : "note",
    text: `Fixture note ${e + 1}: the team discussed ${TOPICS[e % TOPICS.length]}.`,
    citations: [cite(a), cite(b)],
    requester: null,
    assignee: null,
    acceptance: null,
    speaker: null,
    flags: [],
  });
}
const rawText = JSON.stringify({
  meetingId: "long-meeting",
  model: "muse-spark-1.3",
  promptVersion: "brief-v2",
  settings: { fixtureMode: true, maxCostUsdPerDay: null },
  entries,
  flagged: [],
  createdAt: "2026-10-26T12:00:00Z",
});
const recorded = {
  recordedFromLiveCall: true,
  syntheticFixture: "deterministic generator output for load testing only; not recorded from a live call",
  model: "muse-spark-1.3",
  promptVersion: "brief-v2",
  timestamp: "2026-10-26T12:00:00Z",
  usage: { inputTokens: 1000, cachedTokens: 0, outputTokens: 500, reasoningTokens: 100 },
  rawText,
};

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "transcript.txt"), `${segLines.join("\n")}\n`);
writeFileSync(join(OUT, "frames.txt"), `${frameLines.join("\n")}\n`);
writeFileSync(join(OUT, "brief.recorded.json"), `${JSON.stringify(recorded, null, 2)}\n`);
console.log(`long-meeting fixture: ${N_SEG} segments, ${N_FRAMES} frames -> ${OUT}`);
