## new-env-var

Adding an environment variable touches several places, and missing one has meant a production deploy that couldn't start, a template that drifted, or a sync that touched everything. Work through this in order. `docs/ENV_MANAGEMENT.md` explains the layout; `env-vars.config.ts` is the source of truth.

1. **Do you need an env var at all?** A value that is the same in every environment and fine to publish (URLs, hosts, the org timezone, IDs, slugs) goes in `app.config.ts` and is read through `lib/config.ts`; no env var, no sync. Only a secret, or something not fit to publish, becomes an env var. Never a literal in code and never a `??` fallback (`CLAUDE.md`, "No Hardcoded Config").
2. **Declare it in `env-vars.config.ts`**: name, type (`secret` or `config`), group, a description, and its destinations (Vercel preview and/or production, GitHub, Vault). The sync scripts read this file, so nothing else lists variables. A `NEXT_PUBLIC_*` var is never a secret (a test checks); if the client and server both need a value, don't invent two names for it when one will do.
3. **Say where its value goes, and ask the user for it.** The same in every environment (one Zoom, Kajabi, Google or Slack account) goes in `.env.shared`; otherwise `.env.preview` and `.env.prod`, which override `.env.shared`. Those files are gitignored and the user owns them: don't invent a value, don't commit one, and keep a client ID with its secret. Local dev reads `.env.local`.
4. **Update `.env.example`** in the same group order as `env-vars.config.ts`, with the description and an empty or obviously fake value.
5. **Read it in one place** (a small accessor, or `lib/config.ts`) and fail clearly when it's missing where it is required.
6. **Sync it before the code that reads it deploys.** The deploy runs when the PR merges, so a required variable that isn't in Vercel yet breaks production. Give the user the exact command and wait, unless they asked you to run it; these write production secrets.
   - Vercel: `pnpm env:sync --only=NAME` (the flags are `--only=NAME[,NAME...]` and `--target=preview|production`; a typo is rejected, but check the output lists only the variables you meant).
   - GitHub: `pnpm env:sync:github`. Vault (for SQL and pg_cron): `pnpm env:sync:vault`.
   - Sync only what its destinations in `env-vars.config.ts` say; a Vercel-only variable doesn't go to GitHub or Vault.
7. **Docs**: if a document names the variable, which file it lives in or how to rotate it (`docs/ENV_MANAGEMENT.md`, `docs/SECRET_ROTATION.md`), make it match, and check it against the real env files: docs have been wrong about where a token lives.
8. **Rotation**: don't rotate a secret that signs or encrypts things users hold (such as `EMAIL_UNSUBSCRIBE_SECRET`): old links and data stop working. State that in its `description`.

The values themselves never appear in the PR, a commit message, a comment or the chat transcript you write (`public-repo-hygiene.md`).
