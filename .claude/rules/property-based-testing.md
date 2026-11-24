---
paths:
  - "tests/**"
  - "src/lib/**"
  - "src/modules/**"
---

## property-based-testing

A property-based test (PBT, `fast-check`) states a rule that must hold for **any** input and lets the library try hundreds of generated ones, shrinking a failure to its smallest case. It finds what nobody thought to write an example for. It does not replace example tests: those say what the behavior is, a property says what can never go wrong. `tests/lib/url-sanitizers-fuzz.test.ts` is the pattern to copy.

**Use one when the code is a pure function (no DB, network or real clock) and has at least one of these shapes**
- **Takes untrusted input and must not throw or must not emit something unsafe**: sanitizers, parsers (CSV, webhook payloads, Slack markup), signature and token verification, URL, slug and filename builders. This is where it pays most: the example list is whatever the author imagined, an attacker imagines more.
- **Round trip or idempotent**: `parse(sign(x)) == x`, `normalize(normalize(x)) == normalize(x)`, escape then unescape.
- **Invariants over numbers, dates and lists**: Eastern-day and DST math, streaks, pagination and chunking (`chunk(xs)` concatenates back to `xs`), role and permission rules ("a refusal-free change never grants above the actor's own rank").
- **Order or duplicates must not change the result**: dedupe, matching, merging.

**Don't use one**
- For code that needs the database, Slack or Vercel: that is an integration test (`testing-requirements.md`). Extract the pure part and test that.
- When the only property you can state is "the output equals what the code computes" (it re-implements the function). Pick a weaker true statement (a bound, an inverse, an invariance) or stay with examples.
- To test the UI, or where one example already is the whole specification (a lookup table, a label).
- As a way to meet the patch-coverage gate: a property that asserts nothing real is worse than no test.

**How**
- One file per area in `tests/lib/<name>-fuzz.test.ts`, `import fc from "fast-check"`, `fc.assert(fc.property(arb, (x) => { ... }), { numRuns: 200 to 500 })`. They run in `pnpm test:unit` with the rest; keep each file well under a second.
- Generate hostile input on purpose: mix `fc.string()`, `fc.string({ unit: "binary" })` and `fc.constantFrom(...)` fragments joined together (`javascript:`, `..`, `%2e`, `\t`, `//`, `<script`). A uniformly random string rarely hits the interesting prefix.
- No real time: pin "now" with `useFakeClock()` or `vi.setSystemTime()`, and generate dates as arbitrary instants, not `new Date()` (`dates-and-timezones.md`: include DST days and 23:30 and 00:30 Eastern).
- **A failure is a finding.** fast-check prints the seed and the shrunk counterexample: reproduce it with `{ seed, path }`, fix the code, and **add the counterexample as an ordinary example test** so it stays pinned. If it can't be fixed now, write it as a `KNOWN GAP` test and a `docs/TODO.md` entry (`defer-to-todo.md`), not a loosened property.
- Never narrow a property, lower `numRuns`, or add `fc.pre()` filters until it passes. If a property is wrong, say why in a comment and fix the statement.

The ranked list of what to convert next is in `docs/TODO.md`, "Property-based tests: where they pay most".
