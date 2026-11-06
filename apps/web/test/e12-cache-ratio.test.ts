import { describe, expect, it } from "vitest";
import { loadDemo } from "../src/loadFixtures.js";
import { renderBriefPage } from "../src/render.js";

describe("E12 prompt-cache hit ratio", () => {
  it("cacheHitRatio aggregates cached/input across calls", async () => {
    const mod = await import("../src/cacheRatio.js").catch(() => null);
    expect(mod, "cacheRatio module is present").not.toBeNull();
    if (mod === null) return;
    const { cacheHitRatio } = mod;
    expect(
      cacheHitRatio([
        { inputTokens: 1000, cachedTokens: 250 },
        { inputTokens: 1000, cachedTokens: 750 },
      ]).percent,
    ).toBe(50);
    expect(cacheHitRatio([{ inputTokens: 300, cachedTokens: 100 }]).percent).toBe(33.3);
    expect(cacheHitRatio([])).toEqual({ cached: 0, input: 0, calls: 0, percent: null });
  });

  it("demo page shows the cache-ratio element matching recorded usage", async () => {
    const mod = await import("../src/cacheRatio.js").catch(() => null);
    expect(mod, "cacheRatio module is present").not.toBeNull();
    if (mod === null) return;
    const { cacheHitRatio } = mod;
    const demo = loadDemo();
    const usage = demo.cacheUsage;
    const expected = cacheHitRatio(usage);
    const expectedCached = usage.reduce((sum, u) => sum + u.cachedTokens, 0);
    const expectedInput = usage.reduce((sum, u) => sum + u.inputTokens, 0);
    expect(expected.cached).toBe(expectedCached);
    expect(expected.input).toBe(expectedInput);
    const page = renderBriefPage(demo.brief, demo.segments, demo.frames, demo.runLog, {
      pressureFallback: demo.pressureFallback,
      payloadDemo: demo.payloadDemo,
      glimmerLive: demo.glimmerLive,
      briefScore: demo.briefScore,
      seededScore: demo.seededScore,
      heroChain: demo.heroChain,
      cacheUsage: usage,
    } as Parameters<typeof renderBriefPage>[4]);
    expect(page).toContain('id="cache-ratio"');
    expect(page).toContain(`data-cached="${expectedCached}"`);
    expect(page).toContain(`data-input="${expectedInput}"`);
    if (usage.length === 0) {
      expect(page).toContain("no recorded usage");
    } else {
      expect(page).toContain(`${expected.percent}%`);
    }
  });

  it("demo page renders a synthetic cacheUsage", () => {
    const demo = loadDemo();
    const page = renderBriefPage(demo.brief, demo.segments, demo.frames, demo.runLog, {
      pressureFallback: demo.pressureFallback,
      payloadDemo: demo.payloadDemo,
      glimmerLive: demo.glimmerLive,
      briefScore: demo.briefScore,
      seededScore: demo.seededScore,
      heroChain: demo.heroChain,
      cacheUsage: [{ inputTokens: 1200, cachedTokens: 300 }],
    } as Parameters<typeof renderBriefPage>[4]);
    expect(page).toContain('data-cached="300"');
    expect(page).toContain('data-input="1200"');
    expect(page).toContain("25%");
  });
});
