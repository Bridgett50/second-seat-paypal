import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadDemo, WEB_ROOT } from "./loadFixtures.js";
import { renderBriefPage } from "./render.js";
import { findAiSelf } from "./theme.js";

const aiSelf = findAiSelf(WEB_ROOT);

const demo = loadDemo();
const html = renderBriefPage(
  demo.brief,
  demo.segments,
  demo.frames,
  demo.runLog,
  {
    liveDev: false,
    pressureFallback: demo.pressureFallback,
    payloadDemo: demo.payloadDemo,
    glimmerLive: demo.glimmerLive,
    briefScore: demo.briefScore,
    seededScore: demo.seededScore,
    heroChain: demo.heroChain,
    cacheUsage: demo.cacheUsage,
    aiSelfSrc: aiSelf?.url ?? null,
  },
);
const outDir = join(WEB_ROOT, "dist-site", "briefs", "demo");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "index.html"), html);
console.log(`wrote ${join(outDir, "index.html")}`);
if (aiSelf !== null) {
  const dest = join(WEB_ROOT, "dist-site", aiSelf.url.slice(1));
  copyFileSync(aiSelf.file, dest);
  console.log(`wrote ${dest}`);
}
