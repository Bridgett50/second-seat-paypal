# Acceptance registry (canonical)

> Docs/registry only. No sealed input, no model execution, no spending authorized
> by this file. Gaps are listed as gaps, not passes.

The canonical acceptance-ID set is the machine-readable block below. The
readiness ledger in [c9-readiness.md](c9-readiness.md) must contain exactly
this set: no missing IDs, no abbreviated ranges hiding unreviewed items.

```json
{
  "canonicalAcceptanceIds": [
    "C1-1", "C1-2", "C1-3", "C1-4", "C1-5", "C1-6", "C1-7", "C1-8", "C1-9",
    "C2-1", "C2-2", "C2-3", "C2-4", "C2-5", "C2-6", "C2-7",
    "C3-1", "C3-2", "C3-3", "C3-4", "C3-5", "C3-6", "C3-7", "C3-8",
    "C4-1", "C4-2", "C4-3", "C4-4", "C4-5", "C4-6", "C4-7", "C4-8", "C4-9", "C4-10", "C4-11",
    "C5-1", "C5-2", "C5-3", "C5-4", "C5-5", "C5-6", "C5-7", "C5-8", "C5-9", "C5-10", "C5-11", "C5-12",
    "C6-1", "C6-2", "C6-3", "C6-4", "C6-5", "C6-6", "C6-7",
    "C7-1", "C7-2", "C7-3", "C7-4", "C7-5", "C7-6", "C7-7", "C7-8",
    "C8-1", "C8-2", "C8-3", "C8-4", "C8-5", "C8-6", "C8-7", "C8-8", "C8-9",
    "C9-P1", "C9-P2", "C9-P3", "C9-P4", "C9-P5", "C9-P6", "C9-P7", "C9-P8", "C9-P9", "C9-P10",
    "D1-1", "D1-2", "D1-3", "D1-4", "D1-5",
    "D2-1", "D2-2", "D2-3", "D2-4", "D2-5", "D2-6",
    "D3-1", "D3-2", "D3-3", "D3-4", "D3-5",
    "D4-1", "D4-2", "D4-3", "D4-4", "D4-5", "D4-6",
    "D5-1", "D5-2", "D5-3", "D5-4", "D5-5",
    "D6-1", "D6-2", "D6-3", "D6-4", "D6-5",
    "G1-1", "G1-2", "G1-3", "G1-4", "G1-5", "G1-6", "G1-7", "G1-8", "G1-9",
    "G2-1", "G2-2", "G2-3", "G2-4", "G2-5", "G2-6", "G2-7", "G2-8",
    "G3-1", "G3-2", "G3-3", "G3-4", "G3-5", "G3-6", "G3-7", "G3-8", "G3-9", "G3-10", "G3-11", "G3-12",
    "G4-1", "G4-2", "G4-3", "G4-4", "G4-5", "G4-6", "G4-7", "G4-8",
    "G5-1", "G5-2", "G5-3", "G5-4", "G5-5", "G5-6",
    "G6-1", "G6-2", "G6-3", "G6-4", "G6-5", "G6-6", "G6-7", "G6-8"
  ]
}
```

Count: 9 + 7 + 8 + 11 + 12 + 7 + 8 + 9 + 10 + 5 + 6 + 5 + 6 + 5 + 5 + 9 + 8 + 12 + 8 + 6 + 8 = 164 IDs (113 C/D + 51 G; G ledger rows live in [c9-readiness.md](c9-readiness.md)).

## Model paths and verification (per official Meta docs)

Facts below match `/workspace/meta-docs` (general/models.md,
general/overview.md, general/pricing-rate-limits.md,
general/structured-output.md). Model names are identifiers only.

| Path | Model / mechanism | Mode | Live verification |
|---|---|---|---|
| Current session pressure path | deterministic offline patterns (`apps/web/src/session.ts`), no model call | n/a (code, not a model) | ran inside the Oct 28 live session (3/3 at 0365fdb); no separate model call |
| Standalone/historical Shield classifier | `muse-spark-1.3` | Standard mode | Persuasion Shield: experimental layer; on dev set the pattern layer caught 14/14 and Spark added no extra catches; held-out run Nov 2 will test it; live not performed on that held-out split |
| Contributor variant (not used) | `muse-spark-1.3-contributor` | Contributor mode | live not performed; not configured anywhere |
| Brief / support judge | `muse-spark-1.3` | Standard mode | live end-to-end 3/3 on Oct 28 at 0365fdb; rehearsals at 8c00c32 and on #116 |
| Redactor | `meta-models/Muse-Glimmer-30B` (self-hosted vLLM on Modal) | n/a | live end-to-end 3/3 on Oct 28 at 0365fdb (that recording used the previous calendar-date prompt); rehearsals passed at 8c00c32 and on the #116 prompt fix; no new live model call for #116 |

The public link is demo mode with recorded examples. The Oct 28 live run is labeled as a written run summary (owner-attested, synthetic data), not a screen recording. Organizers confirmed recorded runs are fine if labeled. Video URL and user observations remain pending. Founder story: done.

Mode rule: `muse-spark-1.3` is the Standard-mode model ID; the
`-contributor` suffix selects Contributor mode (discounted, content may train
future models). Schema rule: a recursive `json_schema` (a `$ref` cycle) is
rejected with HTTP 400; recursive structures must be flattened to fixed depth.

## Acceptance ledger

Every row names the exact tested head (40-hex commit sha), the behavioral test/probe, the outcome,
and the limitation. No row passes on CI alone.

| ID | Tested head | Behavioral test / probe | Outcome | Limitation |
|---|---|---|---|---|
| C1-1 | 077c7d35d1fa7fd8a967f179187e137fb45831b5 | apps/web/e2e/c1-races.spec.ts:54 (hold A, edit B, release pre-debounce) | pass (before/after probe) | repo test installs clock without explicitly pausing it; a reload after an A->B->A edit during a held approval can still show Copy enabled (F4 partly open) |
| C1-2 | 077c7d35d1fa7fd8a967f179187e137fb45831b5 | apps/web/e2e/c1-races.spec.ts:79 (stale correction, invalidation first) | pass (before/after probe) | old/new real-browser checkbox path not executed |
| C1-3 | 077c7d35d1fa7fd8a967f179187e137fb45831b5 | apps/web/src/server.ts delayed old mutation request vs newer revision (server rejects) | pass at store boundary | HTTP regression inspected, not run |
| C1-4 | 077c7d35d1fa7fd8a967f179187e137fb45831b5 | apps/web/e2e/c1-races.spec.ts:101 (preview A→B, held invalidation) | pass (before/after probe) | debounce interval not explicitly paused in repo test |
| C1-5 | 077c7d35d1fa7fd8a967f179187e137fb45831b5 | apps/web/test/c1-revisions.test.ts:49 (stale p1 acknowledgement) | pass at store boundary | HTTP regression inspected, not run |
| C1-6 | 077c7d35d1fa7fd8a967f179187e137fb45831b5 | apps/web/test/c1-revisions.test.ts:69 (reanalysis identity) | pass at store boundary | HTTP regression inspected, not run |
| C1-7 | 077c7d35d1fa7fd8a967f179187e137fb45831b5 | apps/web/test/c1-revisions.test.ts:86 + e2e/c1-races.spec.ts:135 (uncheck Reviewed) | pass (new-store probe) | old checkbox behavior inspected only; hash destruction not claimed |
| C1-8 | 077c7d35d1fa7fd8a967f179187e137fb45831b5 | apps/web/test/c1-revisions.test.ts:101 (late provider result discarded) | pass (offline/custom analyzer) | does not prove actual HTTP receipts; C2 fake-transport tests cover that boundary |
| C1-9 | 077c7d35d1fa7fd8a967f179187e137fb45831b5 | apps/web/e2e/paste-to-copy.spec.ts positive journey, exact clipboard bytes (pending D2-6) | pending (D2-6) | no exact-clipboard assertion executed at this head |
| C2-1 | b63c1cf28a6973cfea1ef6cd827164553aa36e5d | apps/web/test/c2-receipts.test.ts preflight paused before fetch; no receipt, UI prepared/not dispatched | pass (snapshot probe) | snapshot-level, not active-page |
| C2-2 | b63c1cf28a6973cfea1ef6cd827164553aa36e5d | apps/web/test/c2-receipts.test.ts:124 (held response, fresh snapshot) | partial | manually renders a new snapshot; active pending page still stale (F3) |
| C2-3 | b63c1cf28a6973cfea1ef6cd827164553aa36e5d | apps/web/test/c2-receipts.test.ts:124 + :162 (t0/t1/t2 dispatch time) | pass (before/after probe) | browser-refresh limitation remains |
| C2-4 | b63c1cf28a6973cfea1ef6cd827164553aa36e5d | apps/web/test/c2-receipts.test.ts fetch throws; attempted dispatch stays visible failed/unknown | pass (snapshot probe) | active-page wiring shares F3 limitation |
| C2-5 | b63c1cf28a6973cfea1ef6cd827164553aa36e5d | apps/web/test/c2-receipts.test.ts edit after dispatch, complete old request; receipt kept, result dropped | pass (snapshot probe) | active-page wiring shares F3 limitation |
| C2-6 | b63c1cf28a6973cfea1ef6cd827164553aa36e5d | apps/web/test/c2-receipts.test.ts retryable fail + revoke in backoff; exactly one fetch/receipt | pass (fake-transport probe) | backoff clock is the runner clock only |
| C2-7 | b63c1cf28a6973cfea1ef6cd827164553aa36e5d | services/bot/src/brief/muse.ts refusal guards; probe apps/web/test/c2-receipts.test.ts refusal matrix | pending | refusal matrix not executed at this head; B2-4 pattern only |
| C3-1 | de50552b66c25f5c920dff50b2d5252782ec2c39 | apps/web/test/c3-contract.test.ts:48 (meeting "m" rejected) | pass (before/after probe) | old build failure fixed at de50552 (F6 closed); validator logic only |
| C3-2 | de50552b66c25f5c920dff50b2d5252782ec2c39 | apps/web/test/c3-contract.test.ts other wrong meeting IDs incl. valid seg-1 | pass (before/after probe) | same old build limitation now F6 closed (fixed at de50552) |
| C3-3 | de50552b66c25f5c920dff50b2d5252782ec2c39 | apps/web/test/c3-contract.test.ts:56 + :70 (region:{box:123,unexpected:true}) | pass (before/after probe) | proves schema enforcement, not citation truth; F6 closed (fixed at de50552) |
| C3-4 | de50552b66c25f5c920dff50b2d5252782ec2c39 | apps/web/test/c3-contract.test.ts shared declared schema walk, root/entry/nested fields | pass | F6 closed (fixed at de50552) |
| C3-5 | de50552b66c25f5c920dff50b2d5252782ec2c39 | apps/web/test/c3-contract.test.ts unknown citations rejected; missing_source flags preserved | pass | F6 closed (fixed at de50552) |
| C3-6 | de50552b66c25f5c920dff50b2d5252782ec2c39 | apps/web/test/c3-contract.test.ts valid complete + valid empty accepted; non-JSON never falls back | pass | F6 closed (fixed at de50552) |
| C3-7 | de50552b66c25f5c920dff50b2d5252782ec2c39 | services/bot/src/brief/muse.ts Glimmer→gate→Muse fake-HTTP composition, approval + exact redacted bytes | pending | composition coverage at this head unverified; F6 closed (fixed at de50552) |
| C3-8 | de50552b66c25f5c920dff50b2d5252782ec2c39 | apps/web/src/liveConfig.ts test mode stays offline with live settings + credentials | pending | explicit matrix not executed at this head |
| C4-1 | 1f4b74f1ece34fcaeb4a8fdee7696f6a4095040a | services/bot/test/c4-replay.test.ts:94 (altered totals recomputed) | pass (before/after probe, dummy bundles) | CLI/API on dummy bundles only |
| C4-2 | 1f4b74f1ece34fcaeb4a8fdee7696f6a4095040a | services/bot/test/c4-replay.test.ts:112 (unknown status rejected) | pass (before/after probe) | dummy bundles only |
| C4-3 | 1f4b74f1ece34fcaeb4a8fdee7696f6a4095040a | services/bot/test/c4-replay.test.ts:127 (metadata tamper detected) | pass (before/after probe) | dummy bundles only |
| C4-4 | 1f4b74f1ece34fcaeb4a8fdee7696f6a4095040a | services/bot/test/c4-replay.test.ts:144 (duplicate receipts rejected) | pass (before/after probe) | duplicate manifest plans still open (F8) |
| C4-5 | 1f4b74f1ece34fcaeb4a8fdee7696f6a4095040a | services/bot/test/c4-replay.test.ts:162 (torn tail, all flags false) | pass (strict branch) | legacy/default branch already marked tail incomplete; not a new default fix |
| C4-6 | 1f4b74f1ece34fcaeb4a8fdee7696f6a4095040a | services/bot/scripts/rescore-glimmer-run.mjs removed planned record; full denominators, incomplete | pass | comparison-vs-missing-summary states conflated (F8) |
| C4-7 | 1f4b74f1ece34fcaeb4a8fdee7696f6a4095040a | services/bot/test/c4-replay.test.ts two planned five-span cases: 1/2 completion, 5/5 completed, 5/10 full | pending | denominator coverage at this head unverified; D5 follow-up |
| C4-8 | 1f4b74f1ece34fcaeb4a8fdee7696f6a4095040a | services/bot/test/c4-replay.test.ts reasoning-only fails; empty scores zero; fenced/plain equivalent | pending | coverage at this head unverified; D5 follow-up |
| C4-9 | 1f4b74f1ece34fcaeb4a8fdee7696f6a4095040a | services/bot/scripts/rescore-glimmer-run.mjs unchanged evidence reproduces metrics/report; no input writes | pending | historical-file hashing not performed; D5 follow-up |
| C4-10 | 1f4b74f1ece34fcaeb4a8fdee7696f6a4095040a | services/bot/test/c4-replay.test.ts:224 (CLI --run-dir selects bundle) | pass (current CLI, dummy runs) | already fixed pre-C; historical PR46 CLI not rerun |
| C4-11 | 1f4b74f1ece34fcaeb4a8fdee7696f6a4095040a | services/bot/scripts/rescore-glimmer-run.mjs exit/status semantics: integrity failure vs incomplete vs mismatch | pending | exit-zero ambiguity coverage at this head unverified; D5 follow-up |
| C5-1 | 9a3dd34e41f6d7654c9ff5b93eae175ff31a54d8 | services/bot/test/c5-wiring.test.ts:186 (image digest, inert stub) | pass (unchanged config) | same-path replacement spawns old config (F2) |
| C5-2 | 9a3dd34e41f6d7654c9ff5b93eae175ff31a54d8 | services/bot/test/c5-wiring.test.ts:194 (model revision, inert stub) | pass (unchanged config) | same F2 limitation |
| C5-3 | 9a3dd34e41f6d7654c9ff5b93eae175ff31a54d8 | services/bot/test/c5-wiring.test.ts source/build identity vs packaged bytes; mismatch blocks | partial | launcher/config identity binding incomplete; F2/F7 |
| C5-4 | 9a3dd34e41f6d7654c9ff5b93eae175ff31a54d8 | services/bot/test/c5-wiring.test.ts dummy dataset X packaged/invoked; Y substituted blocks | pass (inert stub) | stub evidence, no real packaging |
| C5-5 | 9a3dd34e41f6d7654c9ff5b93eae175ff31a54d8 | services/bot/test/c5-wiring.test.ts:244 (valueless --cases exits 2) | pass (current CLI) | old fallback inspected, not re-executed |
| C5-6 | 9a3dd34e41f6d7654c9ff5b93eae175ff31a54d8 | services/bot/test/c5-wiring.test.ts:255 (zero/placeholder/whitespace/date) | partial (Python path) | all-zero source/model/image identities validate on new C9 TS path (F7) |
| C5-7 | 9a3dd34e41f6d7654c9ff5b93eae175ff31a54d8 | services/bot/test/c5-wiring.test.ts:279 (FileEntry wrapper) | pass (SDK-shaped stub) | not a real Modal Volume download |
| C5-8 | 9a3dd34e41f6d7654c9ff5b93eae175ff31a54d8 | services/bot/test/c5-wiring.test.ts downloaded dummy tree passes C4 replay, matches metrics | pass (inert stub) | stub evidence only |
| C5-9 | 9a3dd34e41f6d7654c9ff5b93eae175ff31a54d8 | services/bot/test/c5-wiring.test.ts model load/readiness consume work deadline | pass (inert stub) | stub evidence only |
| C5-10 | 9a3dd34e41f6d7654c9ff5b93eae175ff31a54d8 | services/bot/test/c5-wiring.test.ts:356 (deadline during prep, zero calls) | pass (runner clock) | runner clock only |
| C5-11 | 9a3dd34e41f6d7654c9ff5b93eae175ff31a54d8 | services/bot/test/c5-wiring.test.ts:381 (local SIGTERM, readable incomplete) | pass (local-only) | does not prove Modal hard-kill durability |
| C5-12 | 9a3dd34e41f6d7654c9ff5b93eae175ff31a54d8 | services/bot/test/c5-wiring.test.ts documented command exercised through same wiring, not regex | pass | stub wiring only |
| C6-1 | 7af1d4b077a68d4063546fc94553bb73aa271397 | services/bot/test/c6-hermetic.test.ts dummy datasets; no sealed import at module load | pass (static + harness) | static evidence for load-time safety |
| C6-2 | 7af1d4b077a68d4063546fc94553bb73aa271397 | services/bot/test/c6-hermetic.test.ts:29 (lexical guard probe) | partial | guard is lexical only; Windows aliases + parent paths pass through (F9) |
| C6-3 | 7af1d4b077a68d4063546fc94553bb73aa271397 | services/bot/test/gate.test.ts preseeded shared /tmp cap; tests use fresh state | partial (static) | named suites not executed twice; other tests still litter tmp |
| C6-4 | 7af1d4b077a68d4063546fc94553bb73aa271397 | services/bot/test/c6-hermetic.test.ts affected safe suite run twice | pending | not executed twice |
| C6-5 | 7af1d4b077a68d4063546fc94553bb73aa271397 | services/bot/test/glimmer-eval.test.ts tracked evidence byte-unchanged; temp copies / read-only mode | partial (static) | historical artifacts not hashed; full-suite writers uncertified |
| C6-6 | 7af1d4b077a68d4063546fc94553bb73aa271397 | services/bot/test/c6-hermetic.test.ts owned timers/processes/dirs cleaned | partial | C2/C4/C5/C7/C9 tests still leave temp dirs |
| C6-7 | 7af1d4b077a68d4063546fc94553bb73aa271397 | services/bot/test/support/sealed-guard.mjs actual CI/package-hook path performs no sealed/paid work | pending (D3) | full checkout + repo-wide scan outside Node guard (F9) |
| C7-1 | 7442f77538494fd35e0778d104e19aca694fc5d5 | apps/web/src/session.ts not_run/failed/valid_negative/valid_positive represented distinctly | pass | status belongs to assessment; not_run/failed carry no items |
| C7-2 | 7442f77538494fd35e0778d104e19aca694fc5d5 | apps/web/test/c7-pressure.test.ts:60 + :205 (absent/throwing classifier) | partial (thrown error) | nonexistent-span array yields valid_negative only as a closed shape at restacked head (F5 closed) |
| C7-3 | 7442f77538494fd35e0778d104e19aca694fc5d5 | apps/web/test/c7-pressure.test.ts:76 (verbatim term or "term not identified") | partial | string provenance, not unresolved-term validation (F10) |
| C7-4 | 7442f77538494fd35e0778d104e19aca694fc5d5 | apps/web/test/c7-pressure.test.ts:100 (exact nonempty positive array) | pass (assertion + probe) | positive phrase also worked pre-change; coverage, not a new-detection proof |
| C7-5 | 7442f77538494fd35e0778d104e19aca694fc5d5 | apps/web/fixtures/pressure-dev-cases.json urgency/negotiation/neutral dev cases, declared behavior | pass | fixture checks are not model-accuracy evidence |
| C7-6 | 7442f77538494fd35e0778d104e19aca694fc5d5 | apps/web/src/render.ts browser review/unreview/Copy gating with assessment identity | pass (renderer path) | full old/new browser run not executed |
| C7-7 | 7442f77538494fd35e0778d104e19aca694fc5d5 | apps/web/test/c7-pressure.test.ts:190 (assessment inside single Spark request) | partial | proves assessment data in request, not a model assessment in response |
| C7-8 | 7442f77538494fd35e0778d104e19aca694fc5d5 | apps/web/test/c7-pressure.test.ts invalid output / failed analysis stays explicit, no heuristic swap | partial | shaped-but-invalid labels closed at restacked head (F5 closed) |
| C8-1 | d1cd7e1e6814933ead71cbd9750b5cb9a2714f28 | apps/web/test/c8-docs.test.ts:18 (raw→Glimmer, approved redacted→Spark) | pass (prose check) | prose assertion, not transport proof; F1 bypass limits generality |
| C8-2 | d1cd7e1e6814933ead71cbd9750b5cb9a2714f28 | apps/web/test/c8-docs.test.ts precise never-sends-reply-to-vendor wording | pass (prose check) | prose only |
| C8-3 | d1cd7e1e6814933ead71cbd9750b5cb9a2714f28 | apps/web/test/c8-docs.test.ts criterion-level status with commit/CI evidence | partial | ranges omitted C1-9/C2-7/C3-7..8/C4-7..11/C6-7; fixed by D6 |
| C8-4 | d1cd7e1e6814933ead71cbd9750b5cb9a2714f28 | apps/web/test/c8-docs.test.ts pattern-labeled pressure text; no competitive/intent claims | partial | status data-model wording + Shield-row scope fixed by D6 |
| C8-5 | d1cd7e1e6814933ead71cbd9750b5cb9a2714f28 | apps/web/test/c8-docs.test.ts deadline vs billed allocation separate; no hard-cap claim | pass (prose check) | prose only |
| C8-6 | d1cd7e1e6814933ead71cbd9750b5cb9a2714f28 | apps/web/test/c8-docs.test.ts A1–A3 labeled reconstructed | pass (prose check) | prose only |
| C8-7 | d1cd7e1e6814933ead71cbd9750b5cb9a2714f28 | apps/web/test/c8-docs.test.ts pressure review before Copy; one meeting; mode labels | partial | proof-shot quote was whole sentence; fixed by D6 to scripted walkthrough + executed D2-6 e2e |
| C8-8 | d1cd7e1e6814933ead71cbd9750b5cb9a2714f28 | apps/web/test/c8-docs.test.ts founder/observations/URLs pending; nothing invented | pass (prose check) | holds only while humans supply nothing; re-check on any edit |
| C8-9 | d1cd7e1e6814933ead71cbd9750b5cb9a2714f28 | apps/web/test/c8-docs.test.ts historical failures visible; fixture latency labeled fixture | pass (prose check) | prose only |
| C9-P1 | dd7c8c69244872f04515d1a20b07a2625b6dcddb | docs/release/c9-readiness.md readiness requires criterion IDs, not just green CI | partial | checklist dropped C1-9/C2-7/C4-7..11/C6-7 (F12); fixed by D6 |
| C9-P2 | dd7c8c69244872f04515d1a20b07a2625b6dcddb | docs/release/c9-readiness.md holdout review blocked pending authorization | pass (checklist states blocked) | no review performed |
| C9-P3 | dd7c8c69244872f04515d1a20b07a2625b6dcddb | apps/web/test/c9-prep.test.ts (dummy run-config validates) | pass (dummy values) | validation is not runtime binding (F7) |
| C9-P4 | dd7c8c69244872f04515d1a20b07a2625b6dcddb | apps/web/test/c9-prep.test.ts (fake 503, exactly one attempt) | pass (fake HTTP) | transport-attempt option only, not a frozen launch |
| C9-P5 | dd7c8c69244872f04515d1a20b07a2625b6dcddb | docs/release/c9-readiness.md one allocation/canary/concurrency/teardown/download plan | pass (checklist) | plan text, not execution |
| C9-P6 | dd7c8c69244872f04515d1a20b07a2625b6dcddb | docs/release/c9-readiness.md extra Glimmer demo requests declared via glimmerDemoRequests | pass (dummy values) | declaration only |
| C9-P7 | dd7c8c69244872f04515d1a20b07a2625b6dcddb | docs/release/c9-readiness.md failures/denominators preserved in publication policy | pass (checklist) | policy text, not a run |
| C9-P8 | dd7c8c69244872f04515d1a20b07a2625b6dcddb | docs/release/c9-readiness.md PROPOSED $2.10 with unchecked-assumptions label | pass (checklist) | prices/enforcement unchecked; timeout is not a billing cap |
| C9-P9 | dd7c8c69244872f04515d1a20b07a2625b6dcddb | docs/release/c9-readiness.md partner verification pending | pass (checklist states pending) | no confirmation exists |
| C9-P10 | dd7c8c69244872f04515d1a20b07a2625b6dcddb | docs/release/c9-readiness.md one release identity; ≤3:00 video; links checked pre-Nov-4 | pass (checklist) | checklist only; no submission made |
| D1-1 | a23b46295c302113a294713adace48d10f97030a | services/bot/test/d1-provenance.test.ts (unapproved text in assessment, zero fetches) | partly (review verdict D1-1: free-string channel stripped but one fetch still sent) | fake HTTP only |
| D1-2 | a23b46295c302113a294713adace48d10f97030a | services/bot/test/d1-provenance.test.ts valid assessment on same approved text, one request, permitted fields | closed (review verdict D1-2) | fake HTTP only |
| D1-3 | a23b46295c302113a294713adace48d10f97030a | services/bot/test/d1-provenance.test.ts revoke/edit during held preflight, release: zero requests | closed (review verdict D1-3) | fake HTTP only |
| D1-4 | a23b46295c302113a294713adace48d10f97030a | apps/web/test/d1-pressure.test.ts (unknown tactic/segment/quote fail visibly) | closed (review verdict D1-4) | fixture classifiers only |
| D1-5 | a23b46295c302113a294713adace48d10f97030a | apps/web/test/d1-pressure.test.ts valid positive + explicit valid negative controls still work | closed (review verdict D1-5: controls already passed on parent) | fixture classifiers only |
| D2-1 | 9d5dd7fc700c2e76c2f1375bc10dd593b4cb07b1 | apps/web/e2e/d2-approval.spec.ts D2-1 paused-clock A→B held approval keeps B, Copy disabled | closed (review verdict D2-1) | Playwright with fake transport; screen video pending human recording |
| D2-2 | 9d5dd7fc700c2e76c2f1375bc10dd593b4cb07b1 | apps/web/e2e/d2-approval.spec.ts D2-2 A→B→A and A→empty→A stay unapproved until a new explicit click | partly (review verdict D2-2: open page fixed, reload re-enables Copy) | Playwright with fake transport; screen video pending human recording |
| D2-3 | 9d5dd7fc700c2e76c2f1375bc10dd593b4cb07b1 | apps/web/e2e/d2-approval.spec.ts D2-3 held /correct A then B: zero stale approves, server unapproved | closed (review verdict D2-3) | Playwright with fake transport; screen video pending human recording |
| D2-4 | 9d5dd7fc700c2e76c2f1375bc10dd593b4cb07b1 | apps/web/e2e/d2-approval.spec.ts D2-4 fake-fetch invocation shows invoked/pending with t1 on existing page | closed (review verdict D2-4) | Playwright with fake transport; screen video pending human recording |
| D2-5 | 9d5dd7fc700c2e76c2f1375bc10dd593b4cb07b1 | apps/web/e2e/d2-approval.spec.ts D2-5 held state-refresh response cannot restore result/draft/review/approval | closed (review verdict D2-5) | Playwright with fake transport; screen video pending human recording |
| D2-6 | 9d5dd7fc700c2e76c2f1375bc10dd593b4cb07b1 | apps/web/e2e/d2-approval.spec.ts D2-6 full paste→copy flow with exact clipboard bytes, fake transport | partly (review verdict D2-6: stub copy path only, spec not executed here) | Playwright with fake transport; screen video pending human recording |
| D3-1 | 7af1d4b077a68d4063546fc94553bb73aa271397 | services/bot/test/d3-boundary.test.ts dummy sentinels, safe commands | closed (review verdict D3-1) | fake repo only |
| D3-2 | 7af1d4b077a68d4063546fc94553bb73aa271397 | services/bot/test/d3-boundary.test.ts case/symlink/parent-copy/child-process refusals before access | partly (review verdict D3-2) | platform symlink coverage as supported |
| D3-3 | 7af1d4b077a68d4063546fc94553bb73aa271397 | services/bot/test/d3-boundary.test.ts preseeded cap mirror; affected tests use fresh state | partly (review verdict D3-3) | test-owned mirror only |
| D3-4 | 7af1d4b077a68d4063546fc94553bb73aa271397 | services/bot/test/d3-boundary.test.ts safe suites twice; no surviving tmp/processes/timers | open (review verdict D3-4: repeat-check exits 1, not wired into CI) | scoped suites only |
| D3-5 | 7af1d4b077a68d4063546fc94553bb73aa271397 | services/bot/test/d3-boundary.test.ts clean build from empty dist emits web entrypoint + serves /session | partly (review verdict D3-5) | local build only |
| D4-1 | b1ba5dbd50689fe6aec5716fd509cbc5b3426dfe | services/bot/test/d4-config.test.ts (same-path overwrite: no mixed config) | closed (review verdict D4-1) | inert Modal stub only |
| D4-2 | b1ba5dbd50689fe6aec5716fd509cbc5b3426dfe | services/bot/test/d4-config.test.ts all-zero source/model/image + blank review rejected | partly (review verdict D4-2: TS identities fixed, Python half pre-existing) | schema validation, not execution binding |
| D4-3 | b1ba5dbd50689fe6aec5716fd509cbc5b3426dfe | services/bot/test/d4-config.test.ts source/launcher/build drift after freeze rejected | partly (review verdict D4-3) | inert stub only |
| D4-4 | b1ba5dbd50689fe6aec5716fd509cbc5b3426dfe | services/bot/test/d4-config.test.ts dummy settings captured at image/vLLM/runner/request/retry layers | open (review verdict D4-4: launcher ignores token/concurrency/retry settings) | inert stub only |
| D4-5 | b1ba5dbd50689fe6aec5716fd509cbc5b3426dfe | services/bot/test/d4-config.test.ts path aliases: identical bytes deliberate, changed bytes fail | closed (review verdict D4-5) | inert stub only |
| D4-6 | b1ba5dbd50689fe6aec5716fd509cbc5b3426dfe | services/bot/test/d4-config.test.ts one failing proof request, exactly one fake HTTP attempt | partly (review verdict D4-6: option exists but launcher never passes it) | fake HTTP only |
| D5-1 | 6b37061ee2d1726077961e1ac077de20e954a02c | services/bot/test/d5-replay.test.ts (duplicate planned IDs are integrity_failure) | partly (review verdict D5-1: exact duplicates closed, ./ alias not) | dummy bundles only |
| D5-2 | 6b37061ee2d1726077961e1ac077de20e954a02c | services/bot/test/d5-replay.test.ts missing/invalid run ID, unsafe paths, wrong manifest fail first | closed (review verdict D5-2) | dummy bundles only |
| D5-3 | 6b37061ee2d1726077961e1ac077de20e954a02c | services/bot/test/d5-replay.test.ts missing summary/report is complete_uncompared, never verified complete | partly (review verdict D5-3: subset summary can still read complete_match) | declared policy; dummy bundles only |
| D5-4 | 6b37061ee2d1726077961e1ac077de20e954a02c | services/bot/test/d5-replay.test.ts unchanged bundle matches; failure keeps denominator; tail incomplete | partly (review verdict D5-4) | dummy bundles only |
| D5-5 | 6b37061ee2d1726077961e1ac077de20e954a02c | services/bot/test/d5-replay.test.ts altered totals/status/content/metadata/duplicate/missing rejected, no writes | partly (review verdict D5-5) | dummy bundles only |
| D6-1 | 1d19da07260166909d4f7d21ee82f9576923fb64 | apps/web/test/d6-ledger.test.ts (canonical ID-set equality) | closed (review verdict D6-1: ID set equals expected set) | docs/file check, not behavioral |
| D6-2 | 1d19da07260166909d4f7d21ee82f9576923fb64 | apps/web/test/d6-ledger.test.ts (per-row head/probe/outcome/limitation) | open (review verdict D6-2: rows named pre-restack heads and listed F4/F5/F6 as current) | docs/file check, not behavioral |
| D6-3 | 1d19da07260166909d4f7d21ee82f9576923fb64 | apps/web/test/d6-ledger.test.ts (patterns vs historical vs live) | closed (review verdict D6-3) | docs/file check, not behavioral |
| D6-4 | 1d19da07260166909d4f7d21ee82f9576923fb64 | apps/web/test/d6-ledger.test.ts (proof shot file + approval language) | open (review verdict D6-4: unconditional approval wording, video pending) | docs/file check, not behavioral |
| D6-5 | 1d19da07260166909d4f7d21ee82f9576923fb64 | apps/web/test/d6-ledger.test.ts (pending human facts) | closed (review verdict D6-5: pending facts stay pending) | docs/file check, not behavioral |
