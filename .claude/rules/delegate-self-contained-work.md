## delegate-self-contained-work

A long session pays for its whole history on every tool call. A fresh subagent starts small, so a well-briefed feature costs far fewer tokens there than as the next step of a session that has already read hundreds of files and screenshots, and the session stays free for the user. Hand a self-contained piece of work to a subagent instead of doing it inline.

**Delegate when**
- The work is a feature or fix you can describe in a brief: several files, a migration, a repository, UI and tests, ending in a PR.
- The session's context is long and the task does not depend on it (what matters fits in a page).
- Pieces are independent and can run side by side (separate branches, no shared files).

**Don't delegate when**
- It is a handful of tool calls or a lookup whose target you know. A subagent costs a brief and a hand-back; inline is cheaper.
- A decision from the user is still open, or each step's result changes the next (debugging, exploring an unknown).
- It writes to production, merges, or touches anything outward-facing. Those stay with the main session and the user's approval, whoever built the change (`verify-against-prod.md`, `ship-via-pr.md`).
- You can't write a clear brief. That means the problem isn't understood yet: do the thinking first.

**How**
- Use `isolation: "worktree"` so the agent has its own branch and checkout; give it the branch name to create from `origin/main`.
- The brief is all the agent has. Say: the goal and why; the real cases in plain words (fake names only, per `public-repo-hygiene.md`); the files to read first; the constraints that bite (these rules, no production writes, no merging); what to build, numbered; the tests required; and how to ship: PR, watch CI per `pr-watch.md` and confirm all five required checks are listed and passing, never skip or loosen a check.
- Ask for a short report: the PR URL, what changed, design choices it made, what it deferred, what surprised it.
- Don't run the same work yourself while it runs, and don't start several agents for one thing.

**After it reports**
- Treat the report as claims. Check the PR yourself (`gh pr checks <n> --required`, `gh pr view <n> --json state,mergeStateStatus`) before telling the user it passed, and say what you did not verify.
- Relay what matters to the user in your own words; the report is not shown to them.
- After the merge, follow `ship-via-pr.md` step 7: the work is not done until the `main` run is green.
