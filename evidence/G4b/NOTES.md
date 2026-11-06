# G4b: terms and capability claims match evidence

Parent e9a8cdb (#89). Two helper runs:
- Run 1, session a8b8a231 ($1.698). The cap watcher killed it over the $1.50 per-PR cap. Attempt 1 passed verification on G4-6, G4-7 and G4-4r; its evidence is in evidence/G4b-run1. It left 2 stale web tests failing.
- Run 2, session 2cd2cb74 ($0.720, hard cap $0.75, watcher polling about every 4 s). It was scoped to the two stale tests only. Total spend for G4b: **$2.418**.

Behavior:
- resolveUnresolvedTerm shows label.ask only when it is a non-empty substring of the CITED segment and not the whole segment. The comment notes that substring presence does not prove the term is unresolved.
- The pattern path is labelled "deterministic pattern detection" in both the server render and the client JS.
- A valid_negative with zero items renders `<p id="pressure-negative">No pressure items found</p>`, in both server and client.

Independent before/after (parent session.ts and render.ts, head test):
- Before: G4-6 `unrelated-term-accepted` (got 'mangrove'), G4-7 `pattern-mislabeled` (got 'offline pattern check') and G4-4r `negative-invisible` all FAIL. Guard G4-8g passes.
- After: 4/4 pass.

Stale tests updated, only where they asserted the old any-segment term rule. I read both first. Each cites seg-2 but used ask "net-45 terms", which occurs only in seg-3:
- b6-acceptance.test.ts B6-1: the ask is now "sign by 5 today" (inside seg-2).
- c7-pressure.test.ts C7-3: the positive ask is now "the discount" (inside seg-2), and "net-45 terms" was added to the asks that must yield "".
Neither test revealed a product bug.

Process incident (disclosed): I scoped run 2 to only the two test files. The verifier then flagged the uncommitted G4b source edits (session.ts, render.ts, README) as out_of_scope, the helper auto-retried twice, and Muse reverted those files. I restored them byte-for-byte from the verifier's recorded head tree 0f162f0b. They are identical to run 1's verified tree 38e8848c. The auto-retries stayed inside the $0.72.

Hand edit (maintainer): the README sentence on the unresolved term now says "verbatim substring of the cited segment (not the whole segment)", so it matches the new rule.

Full suites (run by maintainer): web 226/226, bot 309/309. One earlier bot run showed a C5-11 failure (a SIGTERM timing test, unrelated to these files). It did not reproduce.
