## read-only-clis

Don't say you can't see production logs, deploys or data without trying. The authenticated CLIs are already on this machine; use them read-only before claiming no access, and report what they show.

**Vercel (runtime logs, deployments).** The CLI is a project dependency, so run it from the worktree as `node_modules/.bin/vercel` (a bare `vercel` isn't on `PATH`). It is logged in. A worktree has no `.vercel` link, so name the project and team instead:

```bash
node_modules/.bin/vercel logs --project hub --scope team_lViDdRth9RpHr2qoZ6rKyfyG --environment production --since 24h --query "conversations.kick" --limit 20
```

- Useful flags: `--since 1h|24h` and `--until`, `--level error|warning|info|fatal`, `--query "<text>"` (matches the log message, e.g. a `console.error` line you added), `--status-code 500`, `--branch`, `--environment production|preview`, `--json`. `--follow` streams live and never returns, so don't use it in a tool call.
- A log line is only as good as what the code logs. When a failure's cause isn't visible, add a `console.error` that names the provider's error code (as `lib/chat/slack-membership.ts` does), ship it, then read it here.
- Other read-only commands: `vercel ls`, `vercel inspect <url>`. Environment variables belong to `new-env-var.md` (`vercel env pull`/`env add` write or reveal secrets: don't, and never paste values anywhere).

**Production database, Supabase and GitHub** are covered by `verify-against-prod.md` (`supabase db query --linked`, `supabase migration list --linked`) and `github-cli.md` (`gh`).

**Limits** (same as `verify-against-prod.md`): read only. Never deploy, promote, roll back, redeploy, set or remove variables, or change a project setting from a session. Logs can hold member data and the repo is public (`public-repo-hygiene.md`): report counts, error codes and shapes, not names, emails or ids.

**If a CLI really isn't usable** (not logged in, command fails): say exactly what you ran and what it returned, and ask the user for the one thing you need. "I can't read the logs" without a failed attempt to quote is not an answer.
