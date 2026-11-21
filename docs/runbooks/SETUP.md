# Setup Guide

> **Status:** living. **Last reviewed:** 2026-11-21. Review: yearly. Kept up to date with the code; if it is wrong, fix it.

Two jobs, in order: get a development machine running on a local Supabase stack, then (rarely) bring up a deployed environment. How environment variables are declared, synced and rotated is in `docs/infrastructure/ENV_MANAGEMENT.md`; how production deploys is in `docs/infrastructure/DEPLOYMENT.md`.

## 1. A development machine

### What to install

- **Docker Desktop** (https://docs.docker.com/desktop/), running: the local Supabase stack runs in containers.
- **Node.js** at the version in `engines.node` of `package.json` (currently 24.x; CI reads the same field) and **pnpm** (the version is pinned by `packageManager` in `package.json`; with Corepack, `corepack enable` is enough).
- **Supabase CLI** (for example `brew install supabase/tap/supabase`).
- **GitHub CLI** (`gh`) for pull requests and CI (`.claude/rules/github-cli.md`).

The Vercel CLI is a project dependency: run it as `node_modules/.bin/vercel` (or `npx vercel`), no global install.

### Steps

1. **Clone and install** (this also points git at the hooks in `config/husky/`: `pnpm install` runs `git config core.hooksPath config/husky`, and that setting is shared by every worktree of the clone, so a worktree on an older branch without that folder has no hooks until it merges `main`):

   ```bash
   pnpm install --frozen-lockfile
   ```

   Every git worktree has its own `node_modules`, so run it again in each one.

2. **Start the local Supabase stack** (the first run downloads the images):

   ```bash
   supabase start
   ```

   `supabase status` (or `pnpm supabase:status`) prints the local URLs and keys again. The ones you use: API `http://127.0.0.1:54321`, Studio `http://127.0.0.1:54323`, and the email catcher (Mailpit) `http://127.0.0.1:54324`, where every email the local stack sends lands. The ports come from `supabase/config.toml`. The migrations in `supabase/migrations/` are applied when it starts; a reset (below) re-applies them and then runs `supabase/seed.sql`.

3. **Create `.env.local`** by copying `.env.example`, then set the three Supabase values from `supabase status`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`. Fill in only the integrations you are working on (Zoom, Kajabi, Google, Slack and so on): the template says what each variable is, in the same order as `config/env-vars.ts`. `.env.local` is gitignored and is never synced anywhere. In a new git worktree, copy the main checkout's `.env.local` (`.claude/rules/worktree-setup.md`): without it `next build`, which the pre-commit hook runs, fails.

4. **Start the app**:

   ```bash
   pnpm dev
   ```

   Open http://localhost:3000.

5. **Sign in.** The app only has magic-link sign-in, and the local stack has public signups off (`enable_signup = false` in `supabase/config.toml`), so create the user first: in Studio, Authentication, Users, "Invite User" (`docs/runbooks/INVITING_USERS.md`, which also says how to give the user a role). Then enter the email on `/login`, click "Send Magic Link", and open the link from Mailpit.

6. **Optional: sample data.** `pnpm seed:local -- --profile <name>` loads a typed seed profile into the local database only (it refuses any other database); `--clear` removes it again. The profiles are in `src/lib/data/profiles/`.

### Checking your change

```bash
pnpm typecheck      # never bare tsc: it runs `next typegen` first
pnpm lint
pnpm test:unit
pnpm test:db        # needs the local Supabase stack
pnpm test:pgtap     # SQL and RLS tests, needs the local stack
pnpm test:smoke
```

After a migration, run `pnpm types:gen` and commit `src/lib/data/database.types.ts`; `pnpm check:migrations` checks the numbering. The workflow for pull requests and CI is in `.claude/rules/ship-via-pr.md` and `.claude/rules/pr-watch.md`.

### Day to day

| Task | Command |
|---|---|
| Stop the stack | `supabase stop` |
| Reset the local database to the migrations and seed | `supabase db reset` |
| Apply new migrations without a reset | `pnpm db:up` |
| Show status and URLs | `supabase status` |
| Reach the dev server from a vendor's webhook (Mux, Zoom, Google Calendar, Slack) | `pnpm tunnel` (`docs/infrastructure/WEBHOOK_SETUP.md`) |

### Troubleshooting

- **"Cannot connect to the Docker daemon"**: start Docker Desktop, restart it if needed.
- **"Port already in use"**: the stack may already be running (`supabase status`); `supabase stop`, then `supabase start`.
- **A magic link never arrives**: look in Mailpit (port 54324), and check the user exists (step 5).
- **"next" or "tsc" not found, or module errors**: `pnpm install --frozen-lockfile` in this worktree.
- **Seeing remote data locally**: `.env.local` must point at `http://127.0.0.1:54321`. Re-copy the values from `supabase status`; never point local development at production.

## 2. A deployed environment

Production is already running; this is for standing up another one (a new Supabase project and Vercel project), or for recreating production. Do the steps in order.

1. **Supabase project.** Create it in the Supabase dashboard, link it (`supabase link --project-ref <ref>`), and follow `docs/infrastructure/DEPLOYMENT.md`, Step 1: migrations pushed, public signups off, RLS verified, API keys. The Auth settings (redirect URLs, SMTP) are config-as-code in `supabase/config.toml`: `pnpm config:diff` shows what would change and `pnpm config:push` applies it, both against the project named in `.env.prod` (`.claude/rules/config-as-code.md`). Migrations after the first push go through CI (`push-migrations` in `.github/workflows/ci.yml`).
2. **Environment files.** Create the gitignored files `.env.shared` (values that are the same in every environment: one Zoom, Kajabi, Google and Slack account), `.env.preview` and `.env.prod` (per-environment values and CI or operations credentials), following `.env.example` and `config/env-vars.ts`. The layering and which variable goes where are in `docs/infrastructure/ENV_MANAGEMENT.md`. Values that are fine to publish belong in `config/app.ts`, not in an env file.
3. **Send the variables where they are read.**

   ```bash
   pnpm env:sync          # Vercel preview and production
   pnpm env:sync:github   # GitHub Actions secrets and variables
   pnpm env:sync:vault    # Supabase Vault (read by SQL and pg_cron)
   ```

   The Vault sync targets the linked Supabase project.
4. **Vercel project and first deploy.** `docs/infrastructure/DEPLOYMENT.md`, Step 2, and "How production deploys": after the first deploy, production ships through the CI workflow on every merge to `main`, not through Vercel's own git deploys. A custom domain is added in Vercel (Project Settings, Domains) and its URL added to the Supabase redirect URLs (`DEPLOYMENT.md`, "Custom Domain").
5. **The rest of the manifests.** Each external service is managed as code with a `diff` before a `push`: `pnpm slack:manifest:diff`, `pnpm sentry:config:diff`, `pnpm github:config:diff`, `pnpm mux:config:diff`, `pnpm vercel:config:diff` (the matching `:push` scripts apply them; CI also pushes some after a deploy). Run a diff first and read it.
6. **First admin.** Invite the first user and set the role (`docs/runbooks/INVITING_USERS.md`, `docs/infrastructure/DEPLOYMENT.md`, Step 4), then walk through the checks in `DEPLOYMENT.md`, Step 5.

Webhook setup for each provider is in `docs/infrastructure/WEBHOOK_SETUP.md`, and the dashboards for every integrated service are in `docs/infrastructure/INTEGRATION_LINKS.md`.
