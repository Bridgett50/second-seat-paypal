# Prompt freeze

Prompt file hashes (sha256):

| file | sha256 |
| --- | --- |
| services/bot/prompts/brief-v1.txt | fe0e1f595d9f3eb5a27afc757e09ead6ad1e165824db7e5724e6d348772bd05a |
| services/bot/prompts/brief-v2.txt | 1fe6a6ded607a5a1fccfe8cd73b4e8215df4bb6c06042418c156e85b67a74cdc |
| services/bot/prompts/pressure-v1.txt | 141e962264623c4407578ace881d9461371d15957e75dfa1684ee52cb7e568ab |
| services/bot/src/private/redact.ts (inline Glimmer system prompt) | 287f1971666026c1df1f14628157873521a32f2e1d528ae882ccc05a8a92d1b5 |

Model ids and settings read from source:

| setting | value | source |
| --- | --- | --- |
| brief model (BRIEF_MODEL) | muse-spark-1.3 | services/bot/src/brief/muse.ts |
| brief reasoning_effort | medium | services/bot/src/brief/muse.ts |
| brief seed (BRIEF_SEED) | 42 | services/bot/src/brief/muse.ts |
| brief max_completion_tokens | 16000 | services/bot/src/brief/muse.ts |
| brief sampling/response_format | response_format: {type:"json_schema", ...strict:true | services/bot/src/brief/muse.ts |
| vision model (SAM_MODEL) | sam-3.1 | services/bot/src/vision/sam.ts |
| shield reasoning_effort | low | services/bot/src/shield/classify.ts |
| shield model | muse-spark-1.3 | services/bot/src/shield/classify.ts |
| redact temperature | 0.0 | services/bot/src/private/redact.ts |
| redact top_p | NOT FOUND | services/bot/src/private/redact.ts |
| judge reasoning_effort | medium | services/bot/src/judge/support.ts |

Fixture mode, not production. Re-run `node services/bot/scripts/prompt-freeze.mjs` to refresh.
