# Deployment Guide

> **Status:** living. **Last reviewed:** 2026-11-23. Review: yearly. Kept up to date with the code; if it is wrong, fix it.

## How production deploys (the CI pipeline)

Production is deployed by one GitHub Actions workflow (`.github/workflows/ci.yml`) on every
push to `main`. Vercel's own git deploys are **off for `main`** (`git.deploymentEnabled.main:
false` in `vercel.json`), so nothing reaches production any other way.

**Jobs on a push to `main`, in order:**

1. `changes` (Detect docs-only change): if every changed file is documentation, the jobs
   below are skipped and nothing deploys (`.claude/rules/docs-only-changes.md`).
2. `check-migrations`, `test-unit`, `test-db` run in parallel. All three must pass.
3. `push-migrations` pushes pending Supabase migrations and the Supabase config to
   production. It runs before the deploy so code that needs a new table or column never goes
   live before it exists.
4. `deploy` runs `vercel pull`, `vercel build --prod` and `vercel deploy --prebuilt --prod`
   for the exact commit that just passed. A failed build or deploy fails the workflow.
5. `push-slack-manifest` and `push-vercel-config` run after `deploy`.

`main` runs one at a time. A run still waiting when a newer merge lands is **cancelled**, and
the newer run contains its commit, so a cancelled run is not a failure but is not a deploy
either. Pull requests get `Coverage report` as well, and Vercel's git integration still
builds a **Preview** for each branch.

### Migration numbers that collide while a PR waits

A PR's `Check migrations` passes against the `main` it had when it ran, and the PR then waits in CI while another migration merges. Keeping that optimistic (no merge queue, no "require branches up to date") has two cheap parts:

- **Re-check at merge time.** `.github/workflows/migration-recheck.yml` runs on a push to `main` that touches `supabase/migrations/**` only. It lists open PRs whose added migration is now at or below `main`'s latest (`scripts/recheck-migration-prs.ts`) and re-runs just their `Check migrations` job, which fetches the current `main` by name, so it fails and auto-merge waits. A PR still running CI is cancelled first (it has to be renumbered and pushed anyway). It is not on the deploy path and not a required check; its token has `actions: write`, `pull-requests: read`, `contents: read` and it only checks out `main`.
- **Cheap recovery.** `pnpm migrations:renumber` (`scripts/renumber-migrations.ts`) renames the branch's stale migrations after `main`'s latest and updates every reference; then `pnpm check:migrations`.

### Seeing what is in production

Three records, all written by the `deploy` job:

- **GitHub deployment record**: the job declares `environment: production`, so each deploy
  creates a record for the commit (Repo → Deployments → Production, or
  `gh api "repos/{owner}/{repo}/deployments?sha=<sha>"`). It moves from `queued` to
  `in_progress` to `success` or `failure`, and links to the canonical URL (`appUrl` in
  `config/app.ts`), not the deployment's own `hub-<hash>.vercel.app` address. The newest
  successful one carries the **Active** badge.
- **The `production` tag**: after a successful deploy the job force-moves the tag to the
  deployed commit. `git log --decorate` shows `(tag: production)` there; everything below it
  is live. Only a successful deploy moves it. A plain `git fetch` won't update a tag that
  exists locally, so fetch it with
  `git fetch origin +refs/tags/production:refs/tags/production`.
- **`git live` and `git undeployed`** are personal git aliases (not in the repo, since git
  config is per machine), built on the tag. `git live` prints the deployed commit,
  `git live -v` adds how many commits on `main` are not yet live, and `git live <sha>` says
  whether one commit is live. `git undeployed` lists the commits not yet live. Pass the
  squash commit on `main`, not a PR branch commit (that one never reaches `main`).

Things that look wrong but aren't:

- **Docs-only commits** never deploy, so they stay "not yet live" until a code commit
  deploys after them.
- **The `Production` environment holds two spellings.** GitHub treats `Production` and
  `production` as one environment. The older records (spelled `Production`, deployed by
  Vercel's git integration before the switch to CI deploys) and ours are in the same list. Don't delete
  the environment: that is the one the `deploy` job writes to.
- **A record can lag.** The job's last status arrives when it finishes, so a deploy that
  just succeeded can read `in_progress` for a minute.

### Verifying what was deployed

Every deploy that succeeds is followed by the `attest` job in `.github/workflows/deploy.yml`,
which signs two statements with GitHub's keyless Sigstore flow (a short-lived certificate tied
to the workflow run; there is no signing key to keep or rotate):

- **Build provenance** (SLSA): this repository, this commit, this workflow run built the subject.
- **An SBOM attestation**: the subject was built with the dependencies listed in a CycloneDX
  1.6 SBOM generated by `pnpm sbom` from `pnpm-lock.yaml` (development dependencies included,
  because the build tools shape the output).

**The subject is a manifest, not the build output.** The `deploy` job hashes every file in
`.vercel/output` (what `vercel deploy --prebuilt` uploads) into `build-output.sha256` (SHA-256
per file, sorted). We do not publish the output itself: workflow artifacts of a public
repository can be downloaded by anyone with a GitHub account, and the server bundles are not
for handing out. The manifest and the SBOM are kept as the workflow artifact
`deploy-provenance` for 90 days.

To verify (needs the `gh` CLI, signed in; works on any machine):

```bash
gh run download <run-id> --repo <owner>/<repo> --name deploy-provenance
gh attestation verify build-output.sha256 --repo <owner>/<repo> --signer-workflow <owner>/<repo>/.github/workflows/deploy.yml
gh attestation verify build-output.sha256 --repo <owner>/<repo> --predicate-type https://cyclonedx.org/bom
```

Find the run with `gh run list --branch main --workflow CI` (or the Help screenshots run for a
redeploy). The attestations themselves stay on the repository (Security → Attestations)
beyond the artifact's 90 days. Passing proves the manifest was produced by that workflow at the
commit named in the attestation (`gh attestation verify ... --format json`). Comparing the
manifest with a particular deployment's files is a manual step and not automated.

**What this is, and is not.** Honest level: SLSA Build L1 (provenance exists and says how the
build ran) and, for the signing, the L2 properties that come from a hosted build platform
generating and signing the provenance (the signer is GitHub's runner identity, not a key we
hold). It is not L3: the build runs in a normal workflow job, not an isolated one, and builds
are not reproducible. Limits to keep in mind:

- The signed statement covers the **files the build produced**, in the job that deploys them.
  It says nothing about what Vercel does after the upload, or about the environment variables
  `vercel pull` fetched (those are runtime values, not attested).
- The `attest` job is separate and has `continue-on-error`, so a signing failure never blocks
  or fails a deploy; it shows as a red job. A deploy without an attestation is therefore
  possible, and its absence is the signal.
- Nothing is published as a package or binary, so there is no release-artifact signing and no
  cosign key.
- Nothing yet checks an attestation automatically (no policy gate before deploy or admission
  step); verification is on demand.

## Setting up from scratch

Production already exists, and the one-time walkthrough that used to be here (creating the
Supabase project, the first Vercel deploy, the first admin invite) went stale: the pipeline
above replaced the manual deploy, and roles, signups and keys moved on. What replaced it:

- **Local and first-time developer setup:** `docs/runbooks/SETUP.md`.
- **Environment variables, where each lives and how to add one:** `docs/infrastructure/ENV_MANAGEMENT.md` and `.claude/rules/new-env-var.md`.
- **Vercel project settings (as code):** `docs/infrastructure/VERCEL_CONFIG.md`.
- **Migrations and what production applies:** `supabase migration list --linked`, and the numbering and expand/contract rules in `.claude/rules/migrations.md`. Migrations reach production only through the `push-migrations` job above.
- **Inviting a member or staff user:** `docs/runbooks/INVITING_USERS.md`.
- **Rotating a secret or key:** `docs/runbooks/SECRET_ROTATION.md`.
- **Moving the domain:** `docs/runbooks/DOMAIN_MIGRATION.md`.
- **Backups and restore:** "Restoring the database" below.
- **When something looks wrong:** "When something looks wrong" below.
- **Signups, auth redirect URLs, RLS:** `docs/trust/RLS_SECURITY.md` and `docs/trust/THREAT_MODEL.md`.


## Restoring the database

Point-in-time recovery is on (see "Plans and headroom" below), so a restore goes to a chosen
moment inside the recovery window (about a week). It is a Supabase dashboard action:
**Database → Backups → Point in Time**, pick the time, confirm. Know before you start:

- A restore replaces the whole production database with its state at that moment, so everything
  written since (member activity, imports, webhooks) is lost. Decide that with the owners first;
  it is not a routine undo.
- Never run Supabase's database reset against production: it wipes the database and reapplies
  the migrations, without the data.
- A bad migration is fixed forward with a new migration (`.claude/rules/migrations.md`:
  expand, then contract), not by restoring.
- Check the window read-only first: `supabase backups list --project-ref <ref>`. After a
  restore, run `supabase migration list --linked` and compare it with the migrations in `main`.

## When something looks wrong

- **Errors in the app:** Sentry (`docs/infrastructure/SENTRY_CONFIG.md`).
- **Runtime logs and deploys:** the Vercel CLI, read-only (`.claude/rules/read-only-clis.md`).
- **Database and auth logs:** Supabase dashboard → Logs, or a read with
  `supabase db query --linked "<select ...>"` (`.claude/rules/verify-against-prod.md`).
- **Is a commit live?** "Seeing what is in production" above.
- **Empty results or "permission denied" for a member:** row level security is working as
  designed until proven otherwise; start with `docs/trust/RLS_SECURITY.md` and
  `.claude/rules/member-identity.md` (sudo).
- **A missing or wrong environment variable:** `docs/infrastructure/ENV_MANAGEMENT.md`.

## Supabase production checklist

How production measures up against Supabase's own checklist, with the gaps and where they are tracked: `docs/checklists/SUPABASE_PRODUCTION_CHECKLIST.md`; the security page's checklist is in `docs/checklists/SUPABASE_SECURITY_CHECKLIST.md`.

## Plans and headroom

Checked read-only on 2026-11-01 with the Vercel and Supabase CLIs (the Supabase CLI doesn't print the plan name, so it is inferred from what the project has):

### Supabase (production project)
- **A paid plan, not Free:** point-in-time recovery is on (`supabase backups list --project-ref <ref>` shows `pitr_enabled: true`; Free has no backups to list), and the database runs on Small-size compute (512 MB shared buffers, `max_connections` 90). Confirm the plan name and the included database and storage sizes on the organization's billing page.
- **Usage that day:** database 442 MB, file storage 793 MB, 38 of 90 connections in use. Biggest tables: `access_events` (119 MB, about 196,000 rows), `slack_messages` (24 MB), `analytics_events` (20 MB).
- **What to watch as use grows:** connections (90 is the hard ceiling for this compute size) and the database size; the usage events are rolled up and pruned after 13 months (`docs/product/ANALYTICS.md`), but the `access_events` rows are kept (the nightly job only removes their raw IP and browser string after 90 days), and it is the largest table.

### Vercel
- **Pro plan, active** (`vercel api /v2/teams/<team id>`, field `billing.plan`). Functions here are capped at 300 s (`maxDuration`).

The development Supabase project's plan isn't recorded here.
