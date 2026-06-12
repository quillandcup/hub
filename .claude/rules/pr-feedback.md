## pr-feedback

## PR review comments
Reply to each thread individually via `gh api repos/{owner}/{repo}/pulls/{pr}/comments/{id}/replies -f body="..."`. Start with `**:robot_face: claude-code:**` prefix. One-liners stay on same line; multi-line responses start content after a blank line. Be concise. No summary comments. Resolve fully addressed comments after replying.

## PR description updates
Update PR description when significant changes are made—whether from addressing review comments or implementing new functionality. Keep the description accurate to what the PR actually does.

## Parallelize across PR feedback sources
Also check the semaphore build and sonarqube for problems and use subagents to aggressively address everything in parallel.
