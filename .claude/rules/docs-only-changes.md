## docs-only-changes

A change that touches only documentation skips the tests, the build and the deploy automatically. You don't do anything to get that, and you must not try to force it.

**How it works.** The first CI job (`Detect docs-only change`) runs `scripts/docs-only.ts`, which lists the files the PR (or the push to `main`) changed. If every one is documentation, the test jobs, the coverage job and, on `main`, the migration push and deploy are skipped at the job level. A skipped job counts as passing for the required checks, so auto-merge works as usual. The pre-commit hook uses the same check to skip the production build on a docs-only commit.

**What counts as documentation**: any `*.md` file (including `CLAUDE.md` and READMEs next to code), everything under `docs/`, and `.claude/rules/*.mdc`. It is an allowlist: one file outside it (a `.yml`, a `.ts`, a migration, `.claude/settings.json`) and the whole change runs everything. An empty diff or any trouble working out the files also runs everything.

**Don't**
- Put `[skip ci]`, `[ci skip]`, `[no ci]`, `[skip actions]` or a `skip-checks:` trailer in a commit message or PR. GitHub then skips the *whole* workflow, which leaves the required checks pending (the PR can never merge) and, on `main`, skips the deploy with nothing verifying that the change was docs. The decision comes from the files, never from the message.
- Use `--no-verify` to get around the pre-commit hook for a docs-only commit; it already skips the build.
- Move code, config or anything read at build or run time into a `.md` file or `docs/` to dodge CI.

**In practice**
- A docs-only PR's checks show the test jobs as skipped; that is expected, not a failure. Watch it per `pr-watch.md` and `ship-via-pr.md` as usual; it just finishes in seconds. After the merge, the `main` run skips migrations and deploy, since there is nothing to ship.
- A PR that mixes docs with code runs everything. Don't split docs into a separate PR just for CI; do split them if they're unrelated to the code change.
- The tests-with-every-change rule doesn't apply to a pure docs change.
- If code ever starts reading a markdown file at build or run time (rendering it on a page, a test that parses it), take that file out of the allowlist in `scripts/docs-only.ts` and update `tests/lib/docs-only.test.ts`.
