# Escalation rules

Second Seat stops and waits for the owner at fixed points. **While a run is
waiting for a person, it makes zero provider (model) dispatches.** Nothing
reaches Muse Spark (brief, support judge, pressure classifier) until the
owner has approved the exact current text, and every stop gives exactly one
reason.

Each rule below is tested in
`services/bot/test/escalation-invariants.test.ts`. A test fails if a rule id
in this file has no matching test, or a test has no matching rule.

| Id | Trigger | Rule | What unblocks it |
|---|---|---|---|
| R1 | Text is prepared (redacted) but the owner has not approved it | `gate.send` refuses with "approval required". The send callback never runs, and all three Spark clients refuse ungated text before any fetch | The owner approves the exact text shown in the preview |
| R2 | The owner edits the text after approving it (`gate.correct`) | The approval is cleared and `send` refuses. Any value already minted from the old text is dead at the transport boundary | The owner re-approves the edited text |
| R3 | The approval covers different text from what is current | `send` refuses as stale | The owner approves the current text |
| R4 | The approval is older than 15 minutes (`APPROVAL_TTL_MS`) | `send` refuses as expired, and a minted value past its expiry is refused at the transport boundary | The owner re-approves |
| R5 | The owner revokes the approval | Every value minted under it is refused at the transport boundary, and no receipt is recorded | A new prepare-and-approve cycle |
| R6 | The approved text contains residual PII (for example, an edit reintroduced an email address) | `send` refuses with "residual PII detected" and names the kind, never the value | The owner corrects the text and re-approves |
| R7 | A fixture-mode approval is presented to a live provider | Refused: a fixture approval cannot authorize live traffic | Run through the live gate with a configured private redactor |
| R8 | The daily call or spend cap is reached | The live client refuses before any fetch (`CostCapExceeded`) | The next UTC day, or the owner explicitly raises `MUSE_MAX_CALLS_PER_DAY` |
| R9 | An unknown run, a forged token, or a hand-built value | Refused with "approval required" | Go through `prepare` → `approve` → `send` |
| R10 | Outgoing text commits to an offer or purchase | Held for the owner (`gateApproval` / `screenOutgoing`) with one reason string | The owner decides; the bot never approves on their behalf |

**One reason per stop.** Each refusal message matches exactly one entry
in the reason catalogue below. The test checks this for every blocked
attempt it makes.

| Reason | Message contains |
|---|---|
| `approval_required` | `approval required` |
| `stale` | `approval is stale` |
| `expired` | `approval expired` |
| `residual_pii` | `residual PII detected` |
| `fixture_not_live` | `fixture-mode approval cannot authorize` |
| `cost_cap` | `refusing live call:` |

## Handoff

When a run stops:
- The owner sees one sentence: the refusal message, which gives a single
  reason.
- The run keeps its state: `runId`, `revision`, and the current masked text
  from `preview`. Nothing is discarded, so the owner can act on it right
  away.
- No dispatch receipt is recorded for a blocked attempt. The receipt
  history (`gate.receipts(runId)`) shows only calls that actually happened.
- Redaction itself runs before approval, by design: raw text goes only to
  the private redactor, never to a Spark provider.

## Resume

When the owner acts (approves, re-approves, or corrects and re-approves):
- The gate mints a **new** approval bound to the current revision and text
  hash.
- Values minted under any earlier approval stay dead. Resuming never revives
  an old approval.
- The run continues from the stored state. A still-valid approval of the current text can authorize more than one dispatch attempt, including a retry. Each attempt checks that the approval is still valid. This is not an exactly-once send.

## Attribution

The structure is adapted from Meta's **legal-agent-workshop**
(<https://github.com/meta-models/legal-agent-workshop>, commit `2a8efc8`,
`agent/ESCALATION_RULES.md`), the Agents 102 session "Best Practices for
Verifiable Agents". The ideas reused are:
- a Trigger / Rule / What unblocks it table;
- the principle that a run waiting for a person makes no model calls;
- Handoff and Resume sections.

That repository publishes no license file (checked 2026-10-28), so no text is
copied. The rules above describe Second Seat's own privacy gate
(`services/bot/src/private/gate.ts`), which this PR does not change.
