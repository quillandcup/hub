# Environment Management Guide

> **Status:** living. **Last reviewed:** 2026-11-21. Review: yearly. Kept up to date with the code; if it is wrong, fix it.

Explains how environment variables are declared, where their values live, how they reach Vercel, GitHub and Supabase Vault, and how they are rotated. Getting a machine or a new environment running is `docs/runbooks/SETUP.md`.

## The three places a value can live

| Where | What | Committed |
|---|---|---|
| `config/app.ts` (read through `src/lib/config.ts`) | Settings that are the same in every environment and fine to publish: URLs, hosts, the org timezone, ids, slugs. No env var, no sync. | yes |
| An env var declared in `config/env-vars.ts` | A secret, or anything not fit to publish (the repo is public). | no (only the declaration) |
| `.env.example` | A template with no real values, in the same group order as `config/env-vars.ts`. | yes |

`CLAUDE.md` ("No Hardcoded Config") is the rule: never a literal or a `??` fallback in code.

## The env files

All gitignored, never committed:

```
.env.local     # local development (the local Supabase stack from `supabase start`); never synced
.env.shared    # same in every deployed environment (one Zoom, Kajabi, Google and Slack account)
.env.preview   # Vercel Preview overrides
.env.prod      # Vercel Production overrides, plus CI and operations credentials (GitHub, Vault)
```

A variable in `.env.preview` or `.env.prod` overrides the same name in `.env.shared` for that environment. `scripts/env-files.ts` does the layering, and `config/env-vars.ts` declares every variable: its name, type (`secret` or `config`), group, description and destinations (Vercel preview and/or production, GitHub, Vault). The sync scripts read only that file, so nothing else lists variables.

Vercel's own "Development" environment is not used (local development runs on `.env.local`), so it is not synced. Whether Preview has its own Supabase project is a question of what `.env.preview` holds; the open work on a separate development project is `docs/TODO.md`, "Multi-Environment Setup".

## Adding or changing a variable

Follow `.claude/rules/new-env-var.md`: decide whether it needs to be an env var at all, declare it, say which file holds its value, update `.env.example`, read it in one place, and sync it before the code that reads it deploys (a required variable missing from Vercel breaks the production deploy). A `NEXT_PUBLIC_*` variable is never a secret (a test checks), because the production build would bake in Vercel's `[SENSITIVE]` placeholder.

## Syncing

After editing `.env.shared`, `.env.preview` or `.env.prod`:

```bash
pnpm env:sync          # Vercel
pnpm env:sync:github   # GitHub Actions secrets and variables
pnpm env:sync:vault    # Supabase Vault, for SQL and pg_cron
```

- **Vercel**: `.env.shared` + `.env.preview` go to Preview, `.env.shared` + `.env.prod` go to Production. To sync only some:

  ```bash
  pnpm env:sync --only=NAME1,NAME2 --target=production
  ```

  `--only` and `--target` also take a space instead of `=`. Anything the script does not understand, including a name that is not synced to Vercel, stops the run with an error rather than syncing everything. A "not a variable synced to Vercel" error usually means your checkout is behind `main` (the heartbeat variables, for instance, are generated from `src/lib/cron-heartbeats.ts`), so pull first.
- **GitHub**: `pnpm env:sync:github --only=NAME[,NAME...]` takes the same `--only` flag; without it every GitHub secret and variable is rewritten.
- **Vault**: production-only secrets, sourced from `.env.prod`, written to the linked Supabase project.
- Sync only what a variable's destinations in `config/env-vars.ts` say.
- These write production secrets, so they are run on purpose, by the owner or on their say-so. A deploy reads values at build time: after changing one, redeploy (or wait for the next merge to `main`).
- **The syncs only add and overwrite.** Removing a variable from `config/env-vars.ts` leaves it in the destinations until it is deleted there by hand (`docs/TODO.md`, "Env Sync Never Deletes").

## Checking where values went

```bash
node_modules/.bin/vercel env ls    # names and the environments each is set for; values are not shown
gh secret list --repo <owner>/<repo>
gh variable list --repo <owner>/<repo>
```

Preview and Production should each list the variables you expect (and Production-only ones such as the webhook secrets only under Production). Read-only checks only: `.claude/rules/read-only-clis.md`.

## Rotating a secret

Rotate on the provider's side first, update the value in the file it lives in, then run a scoped sync (`pnpm env:sync --only=NAME --target=production`, plus the GitHub or Vault sync if its destinations include them). Per-variable steps, and what to do after an exposure, are in `docs/runbooks/SECRET_ROTATION.md`. Do not rotate a secret that signs or encrypts things users hold (such as `EMAIL_UNSUBSCRIBE_SECRET`): old links and data stop working; the variable's description says so.

## Schema and migrations

Migrations are written and tested against the local stack (`supabase migration new <name>`, `pnpm db:up`), reviewed in a PR, and pushed to production by CI before the deploy (`push-migrations`, `docs/infrastructure/DEPLOYMENT.md`). `pnpm db:push` pushes with `.env.prod` and is for out-of-band use only. Migration rules are in `.claude/rules/migrations.md`.

## Security notes

- Safe to commit: `.env.example`, `config/app.ts` values, migration files.
- Never commit: `.env.local`, `.env.shared`, `.env.preview`, `.env.prod`, or paste a value into a PR, comment or chat (`.claude/rules/public-repo-hygiene.md`).
- Never point local development at production: keep `.env.local` on `http://127.0.0.1:54321`.

## See also

- `docs/runbooks/SETUP.md` - machine and environment setup
- `docs/infrastructure/DEPLOYMENT.md` - how production deploys
- `docs/runbooks/SECRET_ROTATION.md` - rotation steps per variable
- [Supabase local development](https://supabase.com/docs/guides/cli/local-development)
- [Vercel environment variables](https://vercel.com/docs/projects/environment-variables)
