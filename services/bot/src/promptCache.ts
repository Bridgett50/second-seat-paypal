// One stable prompt-cache key per call family (one key per shared prefix);
// see Meta docs, "Prompt caching" -> "Group similar requests with a cache key"
// (https://dev.meta.ai/docs/prompt-caching). Caching works without a key;
// the key is only an optional routing hint. Stable constants only,
// never per-user/per-request/per-meeting values.
export const PROMPT_CACHE_KEYS = {
  brief: "second-seat-brief",
  shield: "second-seat-shield",
  support: "second-seat-support",
} as const;
