---
paths:
  - "supabase/migrations/**"
  - "config/squawk.toml"
  - "scripts/check-migration-order.ts"
---

### Migration numbering

A new migration's timestamp must be newer than the latest on `main`, with no duplicate versions: `supabase db push` rejects an older one only after merge, when it fails the deploy. `pnpm check:migrations` (`scripts/check-migration-order.ts`, compared with `origin/main`) runs in the pre-commit hook and in the `Check migrations` CI job, which starts first and fails in seconds: on pull requests against the base branch, and on main against the commit before the push (two PRs that each passed alone can still collide). `push-migrations` waits on it. If it fails, rename the file with a fresh timestamp (and check other worktrees for the number you pick).

### Migrations: expand, then contract

**RULE**: A migration never removes or changes something the code currently live in production still uses. CI pushes migrations *before* the new code deploys, so for the length of a deploy the old code runs against the new schema: a dropped column makes every query that selects it fail (the `member_books.genre` outage, which took down `/projects`).

- **Two PRs.** First PR: stop reading and writing the column/table/function (expand if you need a replacement alongside it). Merge it and wait until its `main` run has deployed (`ship-via-pr.md`, step 7). Second PR: the migration that drops, renames or retypes it.
- **Squawk enforces it.** The `Check migrations` job runs `squawk` (config: `config/squawk.toml`) on the migrations a change adds, with its recommended rules minus the few `config/squawk.toml` turns off, each with its reason. The ones that guard this rule are `ban-drop-column`, `ban-drop-table`, `ban-drop-function`, `ban-drop-constraint` (an upsert's `ON CONFLICT` needs its unique constraint), `renaming-column`, `renaming-table`, `renaming-object` and `changing-column-type`. Run it locally with `pnpm exec squawk supabase/migrations/<file>.sql`.
- **Start a migration that changes an existing table with `set lock_timeout = '5s';`** (`require-lock-timeout`): a DDL statement that waits for a lock queues every query behind it, so it should give up instead. Don't add `statement_timeout`; backfills run longer than it allows.
- **Never add `-- squawk-ignore` or `squawk-ignore-file`, and never add a rule to `excluded_rules`, on your own.** A drop that is safe (the previous PR already deployed, or the table is brand new and unused) still needs the user's explicit approval for that specific statement, every time; ask with the migration and the PR that removed the last use. Once approved, put the reason on a comment line of its own and the bare rule name on the ignore line, directly above the statement: `-- Approved ban-drop-column ignore: the last read was removed in #123, which is deployed.` then `-- squawk-ignore ban-drop-column`. Squawk reads everything after `squawk-ignore` as a comma-separated list of rule names, so a reason on that line makes it warn about unknown names (and `unused-ignore`); see `supabase/migrations/20270402000000_drop_writing_projects_archived_at.sql`.
- Squawk only reads SQL; it can't tell the code stopped using the column. Checking that is on you and the reviewer (an automated check is in `docs/TODO.md`, "Check that a dropped column is no longer referenced").
