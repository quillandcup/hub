## pr-feedback

## PR review comments
Reply to each thread individually via `gh api repos/{owner}/{repo}/pulls/{pr}/comments/{id}/replies -f body="..."`. Start with `**:robot_face: claude-code:**` prefix. One-liners stay on same line; multi-line responses start content after a blank line. Be concise. No summary comments. Resolve fully addressed comments after replying.

**Every review thread must be resolved before the PR can merge**, including threads left by bots and review agents (GitHub's security agent, others). The `main` ruleset requires it, so auto-merge waits on them. For each one, either fix it and reply, or reply with why no change is needed, then resolve it. A green PR that doesn't merge usually has an open thread.

## PR description updates
Update PR description when significant changes are made—whether from addressing review comments or implementing new functionality. Keep the description accurate to what the PR actually does.

## Parallelize across PR feedback sources
Feedback on a PR comes from several places; check all of them, not just the review comments:

- **PR checks** (`gh pr checks <number>`): all of CI, whatever is listed. Failed logs: `gh run view <run-id> --log-failed`. See `pr-watch.md` for watching them.
- **Review comments and bot comments** on the PR: `gh api repos/{owner}/{repo}/pulls/{pr}/comments` for inline threads, `gh pr view <number> --comments` for the conversation.

When more than one source has problems, use subagents to address them in parallel.
