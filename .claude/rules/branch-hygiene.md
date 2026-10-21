## branch-hygiene

A branch serves one pull request. Once that PR merges, the branch is dead: the repo squash-merges, so main has a new commit and the branch's own commits are never merged, and anything pushed afterwards belongs to no PR and never reaches `main`.

**Follow-ups go on a new branch from the latest `main`**
- After a merge, start the next piece of work with `git fetch origin main && git switch -c <new-name> origin/main`. Never commit or push on top of a merged PR's branch, and don't reopen or reuse its name.
- Before any push, check the branch is still live: `gh pr view --json state` for the current branch must be `OPEN` (or there must be no PR yet). The pre-push hook (`scripts/check-push-target.ts`) refuses a push to a branch whose PR merged and tells you what to do; don't set `ALLOW_MERGED_BRANCH_PUSH=1` or `--no-verify` to get past it.
- If you find yourself with commits on a merged branch (you kept working while auto-merge landed it), move them: `git switch -c <new-name> origin/main`, `git cherry-pick <commits>`, open a new PR. Don't force-push or "fix" the old branch.
- Auto-merge can land a PR at any moment after its checks pass, so "wait for the PR" and "keep adding to it" don't mix. To add more to a change, push before the checks finish, or keep it a draft.

**Remote branches delete themselves.** `delete_branch_on_merge` is set in `github-repo-config.yml`, so GitHub removes a PR's branch when it merges, auto-merge included. Don't delete remote branches by hand. The old ones from before the setting are cleaned up with `pnpm branches:prune --remote`, which lists first; only the user runs it with `--apply`, since deleting on the remote is shared state.

**Local branches don't.** Git can't know a squash-merged branch is finished, so run `pnpm branches:prune` (read-only) and then `pnpm branches:prune --apply` to delete local branches whose PR merged and that still point at exactly the merged commit. It keeps anything with an open PR, anything checked out in a worktree, and any branch with commits the merged PR didn't have. Do this at the end of a task, after the `main` run succeeded (`ship-via-pr.md`).

**Worktrees**: a worktree under `~/.paseo/worktrees/` belongs to Paseo and the user; don't remove the one you're running in, just leave it clean (no uncommitted work) and say it can be archived. A worktree you created yourself with `git worktree add` you remove (`git worktree remove`) after its branch has merged.

**The branch name can change under you.** Paseo creates a worktree on a placeholder branch named like the folder (`unarmed-dolphin`), and a rename (`git branch -m`, visible in `git reflog`) can follow shortly after the first prompt, so the folder name and the branch name often differ. Don't assume the branch from the folder, from the start-of-session git status, or from earlier in the conversation: run `git branch --show-current` right before you push or open a PR, and use what it prints. If you switch to a new branch for a follow-up, the folder name stays the same and that is fine.
