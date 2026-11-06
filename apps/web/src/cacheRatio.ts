export interface CacheUsage {
  inputTokens: number;
  cachedTokens: number;
}

export function cacheHitRatio(usages: CacheUsage[]): {
  cached: number;
  input: number;
  calls: number;
  percent: number | null;
} {
  let cached = 0;
  let input = 0;
  for (const usage of usages) {
    cached += usage.cachedTokens;
    input += usage.inputTokens;
  }
  return {
    cached,
    input,
    calls: usages.length,
    percent: input === 0 ? null : Math.round((100 * cached) / input * 10) / 10,
  };
}

export function renderCacheRatio(usages: CacheUsage[]): string {
  const { cached, input, calls, percent } = cacheHitRatio(usages);
  if (calls === 0) {
    return `<p id="cache-ratio" data-cached="0" data-input="0">Prompt cache: no recorded usage</p>`;
  }
  const pct = percent === null ? "n/a" : `${percent}%`;
  return `<p id="cache-ratio" data-cached="${cached}" data-input="${input}">Prompt cache: ${cached} of ${input} input tokens cached (${pct}) across ${calls} recorded call(s)</p>`;
}
