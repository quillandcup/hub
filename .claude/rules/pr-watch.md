## pr-watch

Every new non-draft PR gets auto-merge from `.github/workflows/auto-merge.yml`: it squash-merges itself once the required checks pass. So opening a PR is not the end of the task. Stay on it until it merges or you know why it won't.

## After opening or pushing to a PR

Watch its checks in the background, so you are re-invoked when they finish instead of polling:

```bash
gh pr checks <number> --watch --fail-fast
```

Run it with `run_in_background: true`. Exit code 0 means all checks passed, 1 means one failed, 8 means still pending. Keep working on anything independent while it runs, and don't end your turn with the PR unwatched.

**Exit code 0 alone doesn't mean it passed.** The watch only knows the checks GitHub has reported so far. Right after a push it can see only CodeQL and Vercel, find them green and exit 0 before any CI job exists; `--required` just filters what is reported, so it has the same gap (`Coverage report` doesn't register until both test jobs finish). Never pipe the command through `tail` or similar either: the pipe's exit code replaces `gh`'s. When it exits, confirm with `gh pr checks <number> --required` that every required check from `github-repo-config.yml` is listed and passing (a job skipped by `docs-only-changes.md` counts), and that `gh pr view <number> --json state,mergeStateStatus` is not blocked.

If the CI jobs never appear, the workflow didn't trigger: look for a skip token in the head commit message (GitHub honors one anywhere in it, even quoted in an explanation; amend it out, because a squash merge can carry it onto `main` and skip the deploy) or a merge conflict.

## When CI fails

1. Read the failure: `gh run view <run-id> --log-failed` (get the run id from `gh pr checks <number>`).
2. Fix the cause on the PR's branch and push. Don't re-run a failed job hoping it passes; if you believe it's a flake, say why in your report.
3. Watch the new run the same way. Repeat until green.
4. If the failure isn't yours to fix (infra outage, a check broken on `main` too), stop and tell the user rather than working around it.

Never disable, skip or loosen a check, a test or a coverage floor to get green.

## When CI passes

1. Confirm it merged: `gh pr view <number> --json state,mergedAt,autoMergeRequest,mergeStateStatus`. Don't merge it yourself; auto-merge does that.
2. If it's green but not merged, find out why: unresolved review threads (bots' included; see `pr-feedback.md`), auto-merge turned off (draft, or "Disable auto-merge" clicked), merge conflicts (a PR opened while conflicting never got auto-merge; rebase on `main`, push, and re-check), or a required check still pending. Fix what's yours; otherwise tell the user.
3. Once merged, the work isn't finished: follow step 7 of `ship-via-pr.md` and watch the `main` run until it succeeds. Then report in one line and pick up the next task in your workstream. If there isn't an obvious next one, say the PR landed and ask.

## Reporting

Tell the user the outcome either way: "PR #N failed `Test (unit)`, fixing" or "PR #N merged, starting <next task>". Don't go silent between a push and the result.

Review comments and the other feedback sources (bot comments) are covered by `pr-feedback.md`.
