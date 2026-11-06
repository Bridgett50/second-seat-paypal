Pre-existing: the idea, an earlier prototype, and my AI-self portrait. Built during the event (Oct 26–Nov 4): all the code, partly in a companion repo and brought over on Oct 30.

# Second Seat

## Public demos

- Final demo video (with voiceover, `main` `3922d0e`): https://drive.google.com/file/d/1fHH-3l52XmAqQQHZIogwGGM0O1gY2tw0/view
  This is the verified demo recording. It includes a live Google Meet join with captions. The follow-up and Gmail draft path in that recording is labeled offline.
- Hosted offline meeting-room demo: https://second-seat-offline-demo.onrender.com/meeting-room?demo=1
  This hosted page is the scripted offline demo only. It does not join a live Meet call, and it does not send real Gmail.

The founder story below describes that scripted path. Live Meet join is in the Drive recording, not on the hosted page.

## Founder story

I'm a solo founder running Mo'ja Liquor and Loving Grace Technologies. There are days when I need to be in three different meetings at the exact same time. I can't clone myself, but I can build an AI twin to sit in the second seat.

Second Seat is my answer to the solo founder's paradox: how to scale your time without sacrificing your privacy or your voice. Today, it is a scripted meeting room where my AI twin attends, and I can guide it live or take over instantly. It keeps an evidence record of the session, masks sensitive details, and drafts the follow-up. It checks the draft against an imported email draft. I review and approve the exact package, and it sends through a test path.

It doesn't join live calls yet, and it doesn't send real emails yet. That is the vision. But what is built right now is the safety layer: an AI twin that protects your data and keeps you in the final seat. Changes were reviewed by independent AI reviewers and checked by automated tests, with the results documented in the repo.

## What it does

Vendor calls are where people agree to things they never meant to agree to. Second Seat works in two places: during a meeting, a scripted offline twin sits in the second seat on synthetic data while you guide it or take over, with no model calls; after the meeting, the transcript workflow below turns your pasted meeting text into a cited brief. In the transcript workflow (`/session`), you paste the meeting text. When Live mode is separately configured (see "How to run"), Glimmer, self-hosted on a Modal GPU that is deployed only for owner-run sessions, masks the personal details first. You check and approve that redacted text. Only then does Spark write a short brief where every line cites the part of the meeting it came from: what was offered, what was asked, what needs a decision, and where someone leaned on you. In the default Offline mode, deterministic local code does the masking and the brief, and no model is called. You edit a reply, approve that exact text, and copy it out yourself.

In the current scripted and public demo, Second Seat does not send a real reply or message to the vendor, does not send real email, and does not join real calls. In the meeting room demo, Send works only on a local server started in test mode, where it goes to a test (fake) transport after you approve the exact package; on the public demo site, Send is refused and the evidence record shows the package as unsent. Full permissioned participation and meeting-to-email remain the product direction, not a working feature today. You decide.

The meeting room twin is a scripted demonstration on synthetic data: it calls no model, and its Send reaches the fake transport only in local test mode and is refused on the public site (see "Meeting room demo walkthrough"). The live Glimmer and Spark results under "How to run" come from the separately configured transcript workflow, with the owner-attested qualifications stated there.

Before the approved text is sent, a redaction check has to pass. After the brief is written, a second check has to pass. If a recorded support verdict is available, that is checked too. A hard failure stops the step and the page says "Needs owner review" without quoting the provider. Noisy warnings are sent to you for review and do not block the brief. Offline and Demo Mode run the same checks on the local brief. You still approve the redacted text and the draft yourself.

The web app now includes an experimental candidate drafting flow that works from a single pasted or uploaded text excerpt of up to 6000 characters. After private redaction and owner approval of the exact context, a candidate draft is produced under local policy and can be adopted, edited, saved as part of an approval package, and copied for use. This model-backed path requires existing live Glimmer and Spark configuration with candidate reasoning enabled, and it is not enabled through the public offline wrapper. Google Meet, Gmail, Calendar and Docs are not connected and real sending remains refused, and in this cycle only the gating, browser handling and clipboard behavior were tested with fake providers without live model validation.

## Why this matters to me

In the meeting assistants I tried, I hit two problems. They summarized the whole call and missed the specific financial details I actually needed to act on. And to get those summaries, I had to send private client data, vendor names, and proprietary numbers to someone else's cloud. As a business owner, that was a privacy risk I couldn't take.

So I built Second Seat for myself first. The idea predates this hackathon; this week's build is the live engine. It takes the messy transcript, uses Meta's open-weights model (Glimmer) on GPU hardware I control to mask the supported sensitive-data categories, and asks for my explicit approval. I still review every mask. This is not a guarantee that every sensitive detail is gone. Only then does it use Meta's Spark model to hand me a bulleted brief of what was offered, what was asked, and what needs a decision—with every single claim cited back to the transcript.

Second Seat exists to prove a core philosophy: The future of superintelligence isn't replacing human judgment. It's putting a human in the final seat.

## How to run

Requires Node 20+ and pnpm (via corepack).

```sh
pnpm install
pnpm -r build
pnpm -r test
```

Browser tests use `PLAYWRIGHT_CHROME_PATH` if set, else `/usr/bin/google-chrome` if it exists, else Playwright's bundled Chromium (`pnpm --filter @second-seat/web exec playwright install chromium`).

Offline demo (default; no network, no model calls):

```sh
SECOND_SEAT_TEST_MODE=1 pnpm --filter @second-seat/web serve
```

Open http://localhost:4173/session. The header has:

- **Mode: Offline | Live (Glimmer + Spark).** Offline is the default for every session. Offline redaction and briefs come from deterministic local code, not from Glimmer or Spark, and the page says "Offline demo".
- **Demo Mode.** A streamlined view for recording: a step bar (Paste, Redact, approve the redacted text, Analyze, approve the draft, Copy), larger action buttons, and the payload panel tucked away. Demo Mode is presentation only; owner approval is unchanged. You still click Approve on the redacted text and Approve draft on the reply. Add `?demo=1` to the URL to start with it on.

Live mode (Glimmer on Modal, then Spark) is available only when the server is started with all three of these, and never when `SECOND_SEAT_TEST_MODE=1`:

```sh
SECOND_SEAT_MODE=live GLIMMER_BASE_URL=<your Modal Glimmer URL> META_API_KEY=<set in your shell, never printed> \
  pnpm --filter @second-seat/web serve
```

Then choose **Live** in the header, or open http://localhost:4173/session?mode=live. If Live isn't configured, the page says so and stays Offline. Run `scripts/warmup.sh` first so the Glimmer container is warm. Live end-to-end was verified on Oct 28, 2026 on `main` at `0365fdb`: 3/3 runs passed against the real endpoints. Glimmer on a Modal A100 redacted in about 12.5 s, and Spark `muse-spark-1.3` wrote the brief in 13–19 s. All names, phones and emails were masked, and GPU cost was about $0.22. The Oct 28 live run has an owner-attested run summary (`second-seat-live3-run-summary.md`, private). That is a recorded output, not a screen-recorded video. Rehearsals at `8c00c32` and on the November 15 prompt fix (#116) are owner-attested live calls; this repository does not independently verify those private summaries. The public hosted page is the offline meeting-room demo linked under Public demos above. The screen-recorded demo video is the Drive file linked there (voiceover, `main` `3922d0e`). User observations are still pending.

The image / SAM path is experimental. It is hidden from the UI and makes no calls unless `SECOND_SEAT_EXPERIMENTAL_IMAGES=1`.

## Meeting room demo walkthrough

The twin meeting room has a guided demo that walks all nine steps of the
owner flow against synthetic data only. Run the headless check first:

```sh
node scripts/meeting-room-demo.mjs
```

Then start the server locally on loopback and open the live page:

```sh
SECOND_SEAT_TEST_MODE=1 pnpm --filter @second-seat/web serve
```

Open `http://localhost:4173/meeting-room?demo=1` and press Next (or → / n;
r restarts) through the nine steps. Send uses a fake transport that only
works with `SECOND_SEAT_TEST_MODE=1` on a loopback Host and is refused
everywhere else; never set it on Render. The Playwright suite covers the
same flow in a real browser:

```sh
pnpm --filter @second-seat/web exec playwright test -c playwright.meeting-room.config.ts
```

It uses `PLAYWRIGHT_CHROME_PATH` if set, else `/usr/bin/google-chrome` if it
exists, else Playwright's bundled Chromium.

## Security

The Glimmer Modal endpoint has no auth (F1). It is deployed only during owner-run sessions and stopped right after (`modal app stop second-seat-glimmer -y`, 0 containers). The public link is demo-only.

## How We Use Meta's Models

**Glimmer: private redaction on open weights.** `meta-models/Muse-Glimmer-30B` runs as open weights, self-hosted with vLLM on Modal (one A100-80GB, scale-to-zero, `infra/modal/glimmer_app.py`). It is served from the `vllm/vllm-openai:muse-glimmer` image with `--reasoning-parser muse_glimmer`. Raw meeting text goes only here. Redaction runs at **temperature 0.0** with no top_p/top_k and low reasoning strength, and returns strict JSON spans (`{"spans":[],"boxes":[]}` when there is nothing to mask, plus "never guess"). That follows the cookbook structured-output recipe. We knowingly depart from the vLLM guide's advice against greedy decoding, because redaction has to be repeatable and auditable. Glimmer requests on the web session default to 240 seconds (`LIVE_REDACT_TIMEOUT_MS` in `apps/web/src/liveConfig.ts`). The client and batch default is 90 seconds. A positive `GLIMMER_TIMEOUT_MS` overrides the web default. A request that fails counts as a miss, never as a pass.

**Spark: the cited brief.** `muse-spark-1.3` (Standard mode) gets only the redacted text you approved. Settings: reasoning medium, seed 42, max tokens 16000, and a strict JSON schema in which every brief entry must cite transcript segment IDs. Deterministic checks reject any citation that doesn't resolve to a real segment. A 429 or 5xx gets 4 attempts total (the first try plus at most 3 retries), then fails loudly, with no silent fallback to fixtures. The daily counter counts accounted completions, not every HTTP attempt. A cost guard refuses calls past an estimated $5/day or 50 accounted calls/day. That estimate is not a provider bill and not a Modal cap.

**Prompt cache keys.** Each call family sends one stable `prompt_cache_key`: `second-seat-brief`, `second-seat-shield` and `second-seat-support`. Every family's request then starts with the same prefix, so the cache can actually hit. The demo page shows the cache-hit ratio from stored `cachedTokens`. The recorded brief shows 0 of 2271 input tokens cached. We haven't measured a live cache hit yet.

**Muse Code versus the runtime models.** Muse Code is the coding agent that authored many of this repository's commits (see the end of this README); it is not part of the running app. At runtime, Meta models are called only in Live mode: Glimmer for redaction and Spark for the brief. Offline mode and the meeting room demo call no model. The owner-approval design follows a similar pattern to Meta's cookbook recipe [Build a Local Agent That Asks Before Calling Muse Spark](https://github.com/meta-models/meta-model-cookbook/blob/main/03_use_cases/15_glimmer_api_agent/README.md), in which a person approves the exact text before it is sent to Spark. Approving the email package does not by itself establish every model-egress privacy boundary: in Live mode, raw meeting text goes to Glimmer on Modal before you approve anything, and only the redacted text you approved goes to Spark.

**What we rejected and why**

- *Sending raw text to Spark.* Rejected. In Live mode, the separately configured Glimmer step (self-hosted on Modal) masks personal details first, and a human approves the redacted text before anything reaches Spark. The offline demo calls no model.
- *One shared cache key for every call.* Rejected. Different prompts under one key fragment the cache, so we use one key per call family.
- *Default sampling for redaction.* Rejected. Temperature 0 is set to reduce sampling variation and make masks easier to audit. It is not a proof that the same input always yields identical masks.
- *A model-based pressure classifier in the live session.* Rejected for now. The session uses deterministic patterns, and you must review every flagged item before Copy unlocks. Persuasion Shield: experimental layer; on dev set the pattern layer caught 14/14 and Spark added no extra catches; held-out run Nov 2 will test it. It isn't credited in the demo.
- *Recursive JSON schemas.* Rejected. The API returns HTTP 400 on a `$ref` cycle, so the brief schema is flattened to a fixed depth.
- *Images and SAM in the core flow.* Rejected. The core flow is text-only, and images stay behind an explicit experimental flag.
- *Auto-sending replies.* Rejected. In the transcript workflow (`/session`), Copy is the only exit, and only after you approve the exact draft; in the meeting room demo, Send reaches only a test (fake) transport in local test mode and is refused on the public site.

## Results so far

- Dev meetings (live Spark, recorded outputs): 10/10 brief entries across three development meetings, recall 13/16, about $0.0547 total (`eval/results/dev-briefs.md`).
- Glimmer redaction, historical Modal run (Oct 26): 6/8 requests completed, `complete: false`. It's shown with its limits, not as a headline (`services/bot/fixtures/glimmer-run/`).
- Live end-to-end (Oct 28, 2026, `main` `0365fdb`): 3/3 runs passed. Glimmer on Modal A100 redaction about 12.5 s, Spark `muse-spark-1.3` brief 13–19 s, all names/phones/emails masked, about $0.22 GPU (owner's private run summary).
- Seeded-error support judge: caught 9/9 with 0/4 false alarms on a small synthetic suite (`eval/results/support-score.json`).
- Persuasion Shield: experimental layer; on dev set the pattern layer caught 14/14 and Spark added no extra catches; held-out run Nov 2 will test it (`node eval/resistance-table.mjs --split dev` and `node eval/shield-report.mjs --split dev`, #114/#115).

## Known Issues

- **Ordinary calendar dates are no longer instructed to be masked as `date_of_birth`.** Bridgett Sanders approved this prompt change on Oct 28, 2026. The Glimmer system prompt now says to mask a date as `date_of_birth` only when the text states it is a date of birth or birthday, and to leave ordinary meeting dates unmasked. A generic `DATE` label is not relabeled to `date_of_birth`. Real DOB aliases (`DOB`, `DATE_OF_BIRTH`, `BIRTHDATE`, `BIRTH_DATE`, `BIRTHDAY`) are still masked. The label schema and model pins are unchanged.
  - *Live runs before this change:* the Oct 28 runs masked "November 15" because the previous prompt said to mask every calendar date. Those recorded outputs are unchanged. The current client in `services/bot/src/private/redact.ts` already sends the new prompt on each redaction request. `infra/modal/glimmer_app.py` does not reference that prompt. Redeploying Modal does not activate it.
  - *Offline mode:* "November 15" as a meeting date stays in the text. A phrase such as "born on March 4, 1990" is still masked, as are names, phones, and emails.

## Known limitations

- **L-1: an acting flood can fill the meeting room.** A flood that acts (opens the page and then takes one action per visitor) can still fill all 200 rooms, so new visitors get a 503 "Meeting room is busy" page for up to 30 minutes, until those rooms go idle. The guided demo (`/meeting-room?demo=1`) keeps working during that time, and the 503 page links to it.

## More

- Full PR ledger and engineering log: [docs/engineering-log.md](docs/engineering-log.md)
- Models and settings: [docs/models.md](docs/models.md)
- Failure modes: [docs/failure-modes.md](docs/failure-modes.md)
- Recording script: [RECORDING_SCRIPT.md](RECORDING_SCRIPT.md)
- Friday buyer tryouts: [docs/tryout-protocol.md](docs/tryout-protocol.md)

## Still for Bridgett

These are human tasks. They are not done by tests or by this repair:

- Record the founder clip on a machine whose citation and clipboard checks have actually passed. The demo video is the Drive recording linked under Public demos.
- User tryouts stay pending until she supplies them. The demo video is the Drive recording linked under Public demos above.
- Review any X post herself before it is posted. Nothing here sends it.

The recorded reviews (Opus and Codex, with Grok; see PROVENANCE.md and docs/engineering-log.md) covered the reviewed pull request heads and the test suites listed at those heads; they do not show that every intermediate commit was reviewed or that the full suite passed on every commit.

Muse Code wrote most of the code. Cursor did a repair pass, I directed the work and made hand edits, and other AI tools reviewed it. PROVENANCE.md records who did what.

License: MIT. See [LICENSE](LICENSE).

## PayPal AI Hackathon: Approval-Gated Payments

Added for the PayPal AI Hackathon (November 2026). When a meeting record
contains a payment commitment (an amount, a payee, a purpose), Second Seat
prepares a PayPal order and holds it in **pending owner approval**. Nothing
moves until the owner personally approves or rejects it — the payment form
of this product's rule that the twin drafts and only a person commits.

Flow:

1. `propose` creates the PayPal order (Checkout Orders API, intent CAPTURE)
   and records the commitment as `pending_owner_approval`. Creating the
   order captures nothing; its checkout URL is stored, never acted on.
2. Owner **Approve** moves the record to `approved_for_checkout`: the
   commitment proceeds to the PayPal approval/checkout step. Capture
   happens only after checkout completes.
3. Owner **Reject** cancels the order and records the rejection. (An order
   that was never approved or captured can never charge anyone; PayPal's
   Orders API has no cancel endpoint for one, so rejection abandons it and
   it lapses on PayPal's side.)
4. Every transition is written to an append-only approval log: who, what,
   when, amount, payee, decision, the PayPal order id, and the mode
   (`demo` or `sandbox`) that produced the entry.

Where the code lives:

- `packages/core/src/payments/` — the commitment types, the approval gate
  (state machine + approval log), the `PayPalPort` contract, and the demo
  port. Core stays network-free, per its dependency guard; the HTTP client
  is injected behind the port, as with the T2 meeting connector.
- `apps/web/src/paypalSandbox.ts` — the real sandbox client
  (`createPayPalSandboxPort`) and `paypalPortFromEnv`, which selects demo
  or sandbox from the environment.
- `packages/core/test/payments.test.ts` — state machine and log tests.

Environment variables (sandbox mode):

- `PAYPAL_MODE` — `demo` (default) or `sandbox`.
- `PAYPAL_CLIENT_ID` — your PayPal sandbox app's client id.
- `PAYPAL_CLIENT_SECRET` — your PayPal sandbox app's client secret.

Credentials are read from the environment only; nothing is hardcoded, and
sandbox mode without both values throws and names the missing variable.
The API base is fixed to the sandbox host (`https://api-m.sandbox.paypal.com`);
this client cannot be repointed at the live PayPal API.

Run the demo (judges): DEMO_MODE simulates the PayPal sandbox end to end —
same state machine, same log — with no credentials and no network. Demo
entries are unmistakable: order ids are prefixed `DEMO-ORDER-`, checkout
URLs sit on `demo.invalid` (a TLD that can never resolve), and every log
entry is stamped `"mode": "demo"`.

```sh
pnpm --filter @second-seat/core demo:payments
```

That prints two proposed commitments, an owner approval, an owner
rejection with its cancellation, and the full approval log. To run against
the real sandbox instead, create a sandbox app in your own PayPal
developer account, export the three variables above with
`PAYPAL_MODE=sandbox`, and drive the same gate through
`paypalPortFromEnv` (the web app's port factory).
