# G4a: coherent negative pressure evidence

Parent 5deffc1 (#88). Helper session 1fa92077-9588-4288-acc7-bb18d9fc6236, 1 attempt, verify passed. G4-1, G4-2, G4-3 and G4-2b are certified-regression; G4-4g and G4-5g are guards. Spend $0.82.

Contract: a `tactic: "none"` label is an assessment-level explicit negative. It is valid only when it is the only label, its span is exactly "", and its segment exists (session: an approved segment; adapter: an existing seg-N). Any other "none" is invalid. In the session that means status "failed" and Copy blocked; mixed with a valid positive it is "failed", never valid_positive. In muse.ts it raises UnboundAssessmentError before any fetch. `[]` stays a valid negative.

Independent before/after: parent sources plus head tests. Before: G4-1 `contradictory-none-accepted`, G4-2 `invalid-none-accepted`, G4-3 `mixed-none-dropped` and G4-2b `adapter-none-unvalidated` all FAIL; the guards pass. After: 6/6.

Hand edit (maintainer, separate commit): two stale tests encoded the old none-skip, where a "none" label carried a nonempty span. I read each one and confirmed it intends an explicit negative. Each fix is a one-line change adding `span: ""`:
- apps/web/test/d1-pressure.test.ts:91 (D1-5)
- apps/web/test/b6-acceptance.test.ts:140 (B6-4)
Full suites after the edit: web 222/222, bot 309/309.
