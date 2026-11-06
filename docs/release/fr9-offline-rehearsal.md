# Offline rehearsal of demo/synthetic-transcript.txt

Linux Chromium, offline test server (`SECOND_SEAT_TEST_MODE=1`). No provider call. Not a screen recording and not an owner-attested Spark result. Windows citation and clipboard checks are UNVERIFIED.

Parent of this hardening: `cb5347fbc9361d04617117722c77f2c71494e1f1`. The existing blocked-state assertion was already:

`await expect(page.locator("#session-state")).toHaveText("Review required — check the redacted preview, then approve.")`

That assertion passed on the parent before this change (`playwright test e2e/fr9-synthetic.spec.ts`, 1 passed). It does not accept a generic Error or Completed label.

## What the unchanged transcript does

Initial mock masking does not catch everything:

- `555-013-8844`, `Ellis Ward`, and `Amira Solano` are masked.
- Bare `Amira` remains. Bare `Ellis` does not. `ellis.ward@northglass-retail.example` remains.

The test then replaces the email and bare `Amira` by hand. The one analyzer callback receives that corrected text and does not contain the phone, the email, `Amira`, or `Ellis`.

Approve plus Analyze while the email remains returns to review required, with zero new analyzer callbacks, no new dispatch receipt, a null result, and `draft === null`. The draft section stays hidden and Copy stays disabled. A programmatic click does not call `writeText`.

The later Copy calls `navigator.clipboard.writeText` once. That argument equals the approved draft exactly. On this Linux Chromium, `readText()` also equals that draft, including its spaces. Those are separate checks. A Windows LF-to-CRLF readback was not run.

The server reports that exact draft as approved, and Copy writes it once. On this Linux Chromium, `readText()` also equals that draft, including its spaces. Those are separate checks. A Windows LF-to-CRLF readback was not run. The state response does not include the stored approval hash. Editing the draft clears approval and disables Copy. The same session id is used from paste through that edit. Each citation target's text is contained in the corrected approved text.

## Stored approval hash

Seed, not committed. Only this assignment changed, and the approval comparison stayed `approvedHash === hashDraft(text)`:

```diff
-      s.draft.approvedHash = hashDraft(text);
+      s.draft.approvedHash = "seed-corrupt";
```

Copy stayed disabled. The focused spec failed at the normal enablement check:

```text
Error: expect(locator).toBeEnabled() failed
Locator: locator('#btn-copy')
Expected: enabled
Received: disabled
await expect(page.locator("#btn-copy")).toBeEnabled();
```

The seed was restored before the clean run. The state object does not expose `approvedHash`.

## B-8 sensitivity

These were seeded, then restored. They are not production transitions left in the tree.

- Zero callbacks. Synthetic injection: the analyze route recorded `seeded-callback` before the real analyze. The blocked label still appeared. `expect(leaked).toEqual([])` then failed. Received: `["seeded-callback"]`. Skipping only the session redaction return would still be stopped by the privacy gate and would not reach this callback assertion.
- Stale draft. Seeded assignment on the redaction-block path: `draft` set to `{ text: "stale reply", approved: true }` instead of null. `expect(blocked.draft).toBeNull()` failed. Received that object.
- Exact copy input. Seeded copy handler passed `text + " "` to `writeText`. `expect(writes[0]).toBe(DRAFT)` failed. Received the draft plus one trailing space.

Clean `e2e/fr9-synthetic.spec.ts` was run again after those files were restored.
