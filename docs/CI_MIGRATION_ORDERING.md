# CI/CD Migration Ordering: Option A vs Option B

## The problem

`.github/workflows/ci.yml` auto-pushes pending Supabase migrations to
production after tests+build pass on a push to `main` (see that file's
top-of-file comment). But **Vercel's own git-integration deploy is a
separate, independent trigger** — it fires the moment `main` is pushed and
typically finishes in a minute or two. The GitHub Actions job has to boot a
full local Postgres + Supabase stack, run the whole test suite, then run the
production build, before it even gets to pushing migrations. In practice that
means:

```
push to main
 ├─ Vercel: build + deploy new code ──────────────► live in ~1-2 min
 └─ GitHub Actions: start Supabase, test, build,
                     THEN push migrations ─────────► lands in ~3-6 min
```

New code that depends on a new table/column can go live on Vercel *before*
this workflow has pushed the migration that creates it — the same class of
bug as the `/admin/segments` incident (code merged and deployed, migration
never run, page 500'd until someone remembered to run `db:push` by hand).
Automating the "someone forgot" failure mode doesn't automatically fix the
ordering if Vercel's deploy simply wins the race.

## Option A — keep Vercel's auto-deploy as-is (implemented by default)

Do nothing to Vercel's project settings. `ci.yml` still auto-pushes
migrations after tests pass; it just runs concurrently with, and usually
finishes after, Vercel's deploy.

**Residual risk**: a window of a few minutes per push to main where new code
could 500 on a genuinely new table/column, exactly like the segments
incident.

**Why this is still a big improvement in practice**: the prior failure mode
was "migration gets pushed whenever a human remembers to run
`npm run db:push`" — which could be hours or days, or never until someone
hits the 500. With Option A, the gap shrinks to "a few minutes, reliably,
every single push." Most schema changes are also additive (new table/column)
and don't break *existing* code paths — the risk window mainly bites the
*specific* new code that depends on the *specific* new schema, for the
*specific* few minutes before the migration lands. That's a materially
smaller blast radius than the status quo.

**Effort**: none — this is what's implemented in `ci.yml` today.

## Option B — correct the ordering by gating Vercel's deploy on this workflow

Turn off Vercel's git-triggered production deploy, and instead have this
GitHub Actions workflow trigger the Vercel production deployment itself, as
the *last* step, only after migrations have successfully landed:

```
push to main
 └─ GitHub Actions: start Supabase, test, build,
                     push migrations,
                     THEN call Vercel Deploy Hook ──► Vercel builds + deploys
```

This guarantees the migration is in place before the code that needs it goes
live. It is a real change to how *every* deploy to production works from now
on, not just something scoped to this pipeline — hence not implemented here
without a decision from the project owner.

### What Option B would require, concretely

1. **Create a Vercel Deploy Hook.** Confirmed feasible via the Vercel CLI —
   does not require the dashboard:
   ```bash
   vercel deploy-hooks create ci-migrations-then-deploy --ref main
   ```
   This prints a one-time hook URL
   (`https://api.vercel.com/v1/integrations/deploy/prj_.../...`). Hitting it
   with a `POST` (curl, or the last `run:` step in `ci.yml`) triggers a
   production deployment of the `main` branch. It can also be created from
   the dashboard (Project Settings → Git → Deploy Hooks) if preferred.

2. **Disable Vercel's automatic git-triggered deploy**, so pushing to `main`
   no longer deploys on its own. Two ways to do this, both requiring a
   project-settings change (not something this task should do
   unilaterally):
   - Add to `vercel.json`:
     ```json
     {
       "git": {
         "deploymentEnabled": false
       }
     }
     ```
     (or `{ "git": { "deploymentEnabled": { "main": false } } }` to disable
     only `main` while leaving preview deployments on other branches/PRs
     working normally — this is almost certainly the right variant here,
     since preview deploys on PR branches are unrelated to this ordering
     problem and worth keeping).
   - Or an **Ignored Build Step** in Project Settings → Git that always
     exits `0` (skip) for the production branch — messier and easy to
     forget why it's there; the `vercel.json` `deploymentEnabled` flag is
     the cleaner, self-documenting option and is checked into the repo
     where the rest of this pipeline lives.

3. **Add the hook call as the final step of `ci.yml`'s `push-migrations`
   job**, after `supabase db push` succeeds:
   ```yaml
   - name: Trigger Vercel production deploy
     run: curl -fsS -X POST "$VERCEL_DEPLOY_HOOK_URL"
     env:
       VERCEL_DEPLOY_HOOK_URL: ${{ secrets.VERCEL_DEPLOY_HOOK_URL }}
   ```
   The hook URL should be stored as a GitHub secret (it's a bearer-style
   credential — anyone with it can trigger a production deploy).

4. **Update the PR-preview workflow expectations.** Preview deployments for
   pull requests are unaffected either way (they're not production and
   aren't gated by this workflow) as long as `deploymentEnabled` is scoped to
   `main` rather than set globally to `false`.

### Tradeoffs of Option B

- **Fixes the race correctly** — code and its migration always land
  together, in the right order.
- **Slower time-to-production**: every production deploy now waits for the
  full CI pipeline (Supabase boot + tests + build), not just Vercel's own
  build. Based on the real timing captured for this PR (see the commit
  message / PR description for actual numbers), that's several extra
  minutes added to every production deploy's user-visible latency, not just
  to the migration step.
- **A CI failure blocks deploys entirely.** Today, a flaky/failing test
  doesn't stop Vercel from deploying (the two systems are independent). Under
  Option B, the currently-known ~33 pre-existing flaky test failures (see
  project history — resubscriptions, reconciliation orphans, program-cohort
  overrides, tracked separately) would need to be fully green before *any*
  production deploy could go out. This is arguably correct behavior (don't
  ship on a red suite) but it's a meaningful behavior change worth the
  project owner explicitly signing off on, especially until that flaky-test
  cleanup effort lands.
- **Bigger blast radius if the GitHub Actions runner has an outage** or the
  workflow itself has a bug — Vercel deploys would silently stop happening
  with no independent trigger path, whereas today Vercel's deploy is
  resilient to GitHub Actions being broken.

### Recommendation

Not made here — this is presented for the project owner to decide. Option A
is implemented today. If the flaky pre-existing test suite gets fixed (the
parallel effort already tracked in project history) and the team is
comfortable with slower, CI-gated production deploys, Option B is a clean
follow-up with the concrete steps above.
