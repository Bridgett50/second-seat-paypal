# D6 public-dummy session (scripted walkthrough, fixture mode)

> Fully invented public scenario. No real people, no real vendor, no sealed
> data. Scripted walkthrough in offline fixture mode on the connected
> `/session` flow. This is a scripted walkthrough, not a recording. Screen
> video is pending a human recording.
>
> Executed evidence: Playwright test `apps/web/e2e/d2-approval.spec.ts`
> test title "D2-6" (full paste-to-copy flow with exact clipboard bytes,
> fake transport). The walkthrough below mirrors that executed test.

## Pasted meeting text (invented)

Acme Cloud renewal call. Dana (buyer, invented) meets Lee (vendor, invented).

- Slide: 500 seats, $19/seat/month, renewal by December 1.
- Dana: "We need the security review finished before we sign anything."
- Lee: "This is your last chance to keep the $15 loyalty price."
- Lee: "Only two onboarding slots left this quarter."
- Dana: "I have not agreed to anything. I will review and respond in writing."

## Scripted UI states

1. Paste into `#transcript-input`, click `#btn-redact` → `#session-state`
   reads "Review required". Redacted text shown for review.
2. Correct the redacted text, click `#btn-approve` → state "Approved."
3. Click `#btn-analyze` → state "Completed." Findings cite exact segments
   (`#results .result .citations a` resolving to `#segments`).
4. Pressure assessment (deterministic offline patterns, not a model call):
   one item, tactic `scarcity`, quoting exactly the matched pattern
   substring `last chance` (the pattern emits the match, never the whole
   sentence). Term shown because it is verbatim approved text.
5. Tick each `.pressure-review` checkbox → `#btn-copy` stays disabled until
   every item is reviewed.
6. Type the reply draft into `#draft-text` (including a hasty yes I should
   not send yet). `#btn-copy` stays disabled. Approval requires an explicit
   click on `#btn-draft-approve`; `#draft-status` confirms; `#btn-copy`
   enables. Any edit to the draft or transcript clears the approval.
7. Click `#btn-copy` → clipboard contains exactly the approved draft text.
   Second Seat never sends a reply or message to the vendor.

## Execution-mode label

Offline demo (`#offline-label` visible throughout). No live model call was
performed in this session. Live verification of this walkthrough: not performed.
A separate live end-to-end passed 3/3 on Oct 28, 2026 at 0365fdb. The public
link is demo mode. Video URL and user observations stay pending. Founder story: done.
