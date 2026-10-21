## pr-watch

Every new non-draft PR gets auto-merge from `.github/workflows/auto-merge.yml`: it squash-merges itself once the required checks pass. So opening a PR is not the end of the task. Stay on it until it merges or you know why it won't.

## After opening or pushing to a PR

Watch its checks in the background, so you are re-invoked when they finish instead of polling:

```bash
gh pr checks <number> --watch --fail-fast
```

Run it with `run_in_background: true`. Exit code 0 means all checks passed, 1 means one failed, 8 means still pending. Keep working on anything independent while it runs, and don't end your turn with the PR unwatched.

## When CI fails

1. Read the failure: `gh run view <run-id> --log-failed` (get the run id from `gh pr checks <number>`).
2. Fix the cause on the PR's branch and push. Don't re-run a failed job hoping it passes; if you believe it's a flake, say why in your report.
3. Watch the new run the same way. Repeat until green.
4. If the failure isn't yours to fix (infra outage, a check broken on `main` too), stop and tell the user rather than working around it.

Never disable, skip or loosen a check, a test or a coverage floor to get green.

## When CI passes

1. Confirm it merged: `gh pr view <number> --json state,mergedAt,autoMergeRequest,mergeStateStatus`. Don't merge it yourself; auto-merge does that.
2. If it's green but not merged, find out why: unresolved review threads (bots' included; see `pr-feedback.md`), auto-merge turned off (draft, or "Disable auto-merge" clicked), merge conflicts (a PR opened while conflicting never got auto-merge; rebase on `main`, push, and re-check), or a required check still pending. Fix what's yours; otherwise tell the user.
3. Once merged, report it in one line and pick up the next task in your workstream. If there isn't an obvious next one, say the PR landed and ask.

## Reporting

Tell the user the outcome either way: "PR #N failed `Test (unit)`, fixing" or "PR #N merged, starting <next task>". Don't go silent between a push and the result.

Review comments and the other feedback sources (bot comments) are covered by `pr-feedback.md`.
