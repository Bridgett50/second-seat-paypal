# Demo script (offline engineering proof of one pasted meeting) — target 2:45, max 3:00

# Second Seat — LOCKED 3-minute video script (Oct 29, 2026), revised Nov 1, 2026 with owner approval.

[0:00-0:14] DISCLOSURE (text card, VO): "Disclosure: Pre-existing: the idea, an earlier prototype, and my AI-self portrait. Built during the event (Oct 26–Nov 4): all the code, partly in a companion repo and brought over on Oct 30."

[0:14-0:43] HOOK (on camera): "I'm a solo founder. I run a liquor store and a tech company. I am supposed to be in three meetings at the same time. I can't be. So I built Second Seat—a personal AI twin that sits in the second seat for me. But I don't trust current AI. It hallucinates, it leaks private data, and it acts without permission. I needed a twin that knows its place."

[0:43-1:58] DEMO (meeting room screen recording, VO): "Here is the meeting room. My twin is in the meeting. I can guide it live (show live guidance), or I can take over instantly (show takeover). It keeps an evidence record of the session. When it writes the follow-up, it masks sensitive details. (Show redaction). It checks the draft against an imported email draft. Then, it presents the exact package. I review the draft and the evidence record. I approve it. It will only send the exact text I approved. If anything changes, it won't send. Right now, that send goes through a test path. The live call connection and real email sending come next."

[1:58-2:29] TECH & TRUST (architecture slide): "The meeting room you just saw is a scripted demo with no model calls. Meta's Glimmer and Spark run in a separate transcript workflow. Muse Code wrote most of the code. Cursor did a repair pass, I directed the work and made hand edits, and other AI tools reviewed it. PROVENANCE.md records who did what. Changes were reviewed by independent AI reviewers and checked by automated tests, with the results documented in the repo."

[2:29-2:49] CLOSE (on camera): "Second Seat is the future of the solo founder. It's the leverage to be in two places at once, without giving up your privacy or your control. The future of superintelligence has a human in the final seat. I'm Bridgett Sanders, and this is Second Seat."

# LOCKED Founder Story (README top + submission form description)

I'm a solo founder running Mo'ja Liquor and Loving Grace Technologies. There are days when I need to be in three different meetings at the exact same time. I can't clone myself, but I can build an AI twin to sit in the second seat.

Second Seat is my answer to the solo founder's paradox: how to scale your time without sacrificing your privacy or your voice. Today, it is a scripted meeting room where my AI twin attends, and I can guide it live or take over instantly. It keeps an evidence record of the session, masks sensitive details, and drafts the follow-up. It checks the draft against an imported email draft. I review and approve the exact package, and it sends through a test path.

It doesn't join live calls yet, and it doesn't send real emails yet. That is the vision. But what is built right now is the safety layer: an AI twin that protects your data and keeps you in the final seat. Changes were reviewed by independent AI reviewers and checked by automated tests, with the results documented in the repo.

## Offline engineering proof (not the recorded video)

The LOCKED script above is the video Bridgett records. The material below is the earlier offline engineering proof of one pasted meeting, kept as a checklist.

This plan is an offline take labeled Offline demo. It is a safe fallback, not a decision that the submission must be offline-only. A future live clip is optional and would replace time inside this plan. It is not authorized and not recorded here.

Timecodes include speech at about 150 words per minute plus clicks, corrections, waiting, and short pauses. The timing table is an unspoken note at the end.

Founder story: done — supplied in the README founder section. User observations: PENDING — not yet supplied. Video URLs: PENDING — not yet supplied. Windows citation and clipboard checks: PENDING. Record nothing for the pending slots until they are supplied; invent no quotes, anecdotes, or URLs.


The whole video follows ONE meeting through the connected `/session` flow: paste the unchanged `demo/synthetic-transcript.txt`, look at the local mock, show the blocked Analyze, correct by hand, approve, analyze, click a citation that is on the page, type a draft, approve that exact text, copy once, and edit a word so Copy turns off. No screenshot upload. No SAM. No timed replay.

| Time | On screen | Bridgett says |
|---|---|---|
| 0:00–0:25 | Bridgett on camera. Disclosure card visible: "Pre-existing: the idea, an earlier prototype, and my AI-self portrait. Built during the event (Oct 26–Nov 4): all the code, partly in a companion repo and brought over on Oct 30." | "The disclosure and hook from the LOCKED script above, spoken verbatim." |
| 0:25–0:40 | `/session?demo=1`. "Offline demo" label (`#offline-label`) stays visible. Paste the full unchanged `demo/synthetic-transcript.txt` into `#transcript-input`. Click `#btn-redact`. State reads "Review required". | "I paste that made-up call in. This is an offline demo." |
| 0:40–0:50 | Preview: full names and `555-013-8844` are masked. Bare `Amira` is still visible. `ellis.ward@northglass-retail.example` is still visible. Do not correct them yet. Do not credit this preview to a model. | "The phone and the full names are masked. Bare Amira and the email are still visible." |
| 0:50–1:08 | Click `#btn-approve` while the email is still in the preview. Click `#btn-analyze`. State returns to "Review required — check the redacted preview, then approve." No findings appear. Unspoken note, not a caption: historical evidence for a different meeting remains Playwright test [apps/web/e2e/d2-approval.spec.ts](../../apps/web/e2e/d2-approval.spec.ts) test "D2-6" (full paste-to-copy flow with exact clipboard bytes, fake transport); scripted walkthrough in [apps/web/proof/d6-public-demo-session.md](../../apps/web/proof/d6-public-demo-session.md) (screen video pending a human recording). Do not say this paste shows "last chance" or a fifty-dollar gap. | "This Analyze attempt was blocked before downstream analysis." |
| 1:08–1:30 | Select the email and type `[REDACTED_email]`. Select bare `Amira` and type `[REDACTED_person]`. Click `#btn-approve`. State reads "Approved." Click `#btn-analyze`. Wait until the state reads "Completed." | "I replace the email and the bare first name, then I approve this exact text." |
| 1:30–1:48 | Two findings, each with a citation that resolves on this page. Click one of those citations. No pressure item. Heading reads "Needs owner review" and says claim support was not checked. Do not say the screen caught a fifty-dollar gap or a November 15 badge. | "Only the text I approved gets analyzed. I see two findings and no pressure item. The heading says the claim check did not run." |
| 1:48–1:56 | This transcript shows no `.pressure-review` checkbox. Do not tick or click a checkbox that is not on screen. | "There is nothing to check here. Copy is not waiting on a pressure box for this meeting." |
| 1:56–2:24 | In `#draft-text`, type: "Please send a corrected written quote. I have not accepted the deadline." `#btn-copy` stays disabled until approval. Click `#btn-draft-approve` with an explicit click. `#btn-copy` enables. Click `#btn-copy` once. Then change one word. `#btn-copy` disables. | "I write the reply, I approve that exact text, and I copy it once. I change one word and Copy turns off. Second Seat never sends a reply or message to the vendor." |
| 2:24–2:34 | One card, already on screen, for at most ten seconds. Unspoken file cites, not generated by this take: support 9/9 seeded errors and 0/4 false alarms [eval/results/support-table.md]; rules 71/71 seeded mutants blocked or escalated and 0/13 semantic gaps caught [eval/results/rules-table.md]. | "Small seeded tests, not this take. Rules blocked or escalated these examples; semantic gaps remain." |
| 2:34–2:45 | Logo. | "A human in the final seat." |

## Unspoken notes (not captions)

- The blocked Analyze is one refused request. Do not say that nothing was ever sent, or that raw text never left a server. In a future live take, raw text would already have reached the redactor before this check. That live take is NOT YET AUTHORIZED / NOT YET RECORDED. It would replace time inside this plan. It does not add time, and this script has no deploy or warmup steps.
- The Oct 28 owner-attested run summary stays with commit `0365fdb` and that run's own input. It is not this synthetic transcript and not an independently checked clip.
- Superseded wording (no longer claimed): "any edit to the draft or transcript clears the approval" — replaced by the open-page plus reload-caveat narration above (F4 partly open).
- Show only the connected `/session` paste-to-copy flow. No screenshot upload and no SAM in this video.
- User observations and video URLs stay PENDING. Windows checks stay PENDING.

## Timing (unspoken)

| Beat | Clock | Speech words | Speech at 150 wpm | Actions | Slot |
|---|---|---|---|---|---|
| Disclosure and hook (LOCKED script above) | 0:00–0:25 | see LOCKED script | see LOCKED script | show the card, about 3 s | 25 s |
| Paste and Redact | 0:25–0:40 | 11 | 4 s | paste, click, wait, about 8 s | 15 s |
| Point at mock misses | 0:40–0:50 | 14 | 6 s | point, about 4 s | 10 s |
| Blocked Analyze | 0:50–1:08 | 8 | 3 s | approve, analyze, wait, about 12 s | 18 s |
| Hand correction, approve, analyze | 1:08–1:30 | 16 | 6 s | two replacements, approve, analyze, about 14 s | 22 s |
| Two findings and one citation | 1:30–1:48 | 24 | 10 s | click the citation, about 4 s | 18 s |
| No pressure checkbox | 1:48–1:56 | 16 | 6 s | look, about 2 s | 8 s |
| Draft, one Copy, edit | 1:56–2:24 | 32 | 13 s, overlapping the typing | type, approve, copy, edit one word, about 16 s | 28 s |
| Evidence card | 2:24–2:34 | 15 | 6 s | card already visible | 10 s |
| Close | 2:34–2:45 | 6 | 2 s | logo hold | 11 s |
| Total | 0:00–2:45 | 142 plus the LOCKED opening | about 56 s plus the LOCKED opening | actions and pauses fill the rest | 165 s |
