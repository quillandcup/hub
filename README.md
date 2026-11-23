# Hedgie Hub

The member platform for [Quill & Cup](https://quillandcup.com), a community of writers who show up to write together. Members see their own writing journey and take part in the community; staff get the tools to run it and see how it is doing.

<p>
  <a href="https://github.com/quillandcup/hub/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/quillandcup/hub/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://github.com/quillandcup/hub/actions/workflows/code-quality.yml"><img alt="Code quality" src="https://github.com/quillandcup/hub/actions/workflows/code-quality.yml/badge.svg?branch=main"></a>
  <a href="https://github.com/quillandcup/hub/actions/workflows/ci.yml"><img alt="Coverage" src="https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fquillandcup%2Fhub%2Fbadges%2Fcoverage.json"></a>
  <a href="https://hub.quillandcup.com"><img alt="Hub uptime" src="https://api.checklyhq.com/v1/badges/checks/d4e1e531-5370-4982-a996-317709722dc6"></a>
  <a href="LICENSE"><img alt="License: Proprietary" src="https://img.shields.io/badge/license-proprietary-lightgrey"></a>
</p>

<p>
  <a href="https://scorecard.dev/viewer/?uri=github.com/quillandcup/hub"><img alt="OpenSSF Scorecard" src="https://api.scorecard.dev/projects/github.com/quillandcup/hub/badge"></a>
  <a href="https://github.com/quillandcup/hub/actions/workflows/audit.yml"><img alt="Dependency audit" src="https://github.com/quillandcup/hub/actions/workflows/audit.yml/badge.svg?branch=main"></a>
  <a href="https://github.com/quillandcup/hub/actions/workflows/osv-scan.yml"><img alt="OSV scan" src="https://github.com/quillandcup/hub/actions/workflows/osv-scan.yml/badge.svg?branch=main"></a>
  <a href="https://github.com/quillandcup/hub/actions/workflows/gitleaks.yml"><img alt="gitleaks" src="https://github.com/quillandcup/hub/actions/workflows/gitleaks.yml/badge.svg?branch=main"></a>
  <a href="https://github.com/quillandcup/hub/actions/workflows/zap-baseline.yml"><img alt="ZAP baseline" src="https://github.com/quillandcup/hub/actions/workflows/zap-baseline.yml/badge.svg?branch=main"></a>
</p>

<p>
  Coverage by area:
  <img alt="src/lib" src="https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fquillandcup%2Fhub%2Fbadges%2Fcoverage-lib.json">
  <img alt="src/components" src="https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fquillandcup%2Fhub%2Fbadges%2Fcoverage-components.json">
  <img alt="src/app/api" src="https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fquillandcup%2Fhub%2Fbadges%2Fcoverage-app-api.json">
</p>

## What it does

**Members** get a place of their own:

- Their writing journey: dashboard, streaks, awards, writer profile and titles, projects, bookshelf and goals.
- The community: the prickle (writing session) schedule and picker, events, chat that mirrors Slack, big sisters, member directory and search.
- Learning: courses, a help center and a "What's new" changelog.
- Control over how they are reached: notification settings, per-member channels and timezone.

**Staff** get the tools to run the community (under `/admin`, gated by permissions rather than a single admin flag):

- Attendance, check-ins, commitments and analytics, so they can see who is showing up, who is at risk of drifting away and which sessions are thriving.
- Members: matching and merging duplicates across systems, onboarding and invites, billing and reminders.
- Content: landing pages with a page builder, courses, the media library and the changelog.
- Operations: audit and activity logs, imports and reconciliation, feature flags.

Hedgie Hub brings together data from Kajabi, Zoom, Google Calendar, Slack, Stripe and others. Each feature has a write-up in [`docs/product/`](docs/product/).

## Tech stack

- **App**: Next.js (App Router, Server Components), React, TypeScript, Tailwind, TipTap for rich text.
- **Data**: Supabase (Postgres with row level security, invite-only Auth, Storage, pgmq queues), accessed through repositories in `src/lib/data/`.
- **Hosting and ops**: Vercel, Sentry, Checkly (monitoring as code in `config/checkly/`), GitHub Actions.
- **Tests**: vitest (unit and db suites), pgTAP for SQL and RLS, Playwright for smoke tests and the demo scenes.

## Architecture

Data moves through four layers, so anything derived can always be rebuilt:

- **Bronze**: raw data as it came from Kajabi, Zoom, Calendar, Slack and the rest, with no inference.
- **Local**: data the app owns itself.
- **Silver**: inferred and enriched data (attendance, metrics), reprocessable from Bronze and Local.
- **Gold**: analytics computed on demand.

Details: [`docs/architecture/MEDALLION_ARCHITECTURE.md`](docs/architecture/MEDALLION_ARCHITECTURE.md) and [`supabase/ARCHITECTURE.md`](supabase/ARCHITECTURE.md). The rest of [`docs/architecture/`](docs/architecture/) covers the data access layer, permissions, member matching, the event log and the chat module.

## Quick start

You need Docker Desktop (running), Node.js (the version in `engines.node` of `package.json`), pnpm and the Supabase CLI. The full walkthrough, including a deployed environment, is in the [Setup Guide](docs/runbooks/SETUP.md).

```bash
pnpm install        # also points git at the hooks in config/husky
supabase start      # local Postgres, Auth, Studio and the email catcher
pnpm dev            # http://localhost:3000
```

To sign in locally, enter any email on the sign-in page and open the magic link from the local email catcher (Mailpit) at http://127.0.0.1:54324.

| Service | URL |
|---|---|
| App | http://localhost:3000 |
| Supabase Studio | http://127.0.0.1:54323 |
| Local email | http://127.0.0.1:54324 |

The `pre-commit` hook runs a production build to catch type errors before they are committed (and skips it for docs-only commits). Day-to-day commands are in [`CLAUDE.md`](CLAUDE.md); how the tests fit together is in [`docs/runbooks/TESTING.md`](docs/runbooks/TESTING.md).

## Documentation

Everything lives under [`docs/`](docs/README.md), sorted by whether a doc is maintained with the code or kept as a snapshot.

- [Product Requirements Document](docs/decisions/PRD.md) and the per-feature docs in [`docs/product/`](docs/product/)
- [Setup Guide](docs/runbooks/SETUP.md), the [Testing guide](docs/runbooks/TESTING.md) (suites, guard tests and the exception lists still to clean up) and the other [runbooks](docs/runbooks/)
- [Architecture](docs/architecture/) and [Database architecture](supabase/ARCHITECTURE.md)
- [Infrastructure](docs/infrastructure/) (Vercel, Sentry, Slack, Mux, Kajabi, webhooks) and [Deployment](docs/infrastructure/DEPLOYMENT.md)
- [Security and privacy posture](docs/trust/)
- [Backlog](docs/TODO.md)

## Contributing and security

How to report a bug, what we accept and how decisions are made: [CONTRIBUTING](.github/CONTRIBUTING.md), [GOVERNANCE](.github/GOVERNANCE.md), [CODE_OF_CONDUCT](.github/CODE_OF_CONDUCT.md). To report a vulnerability privately, see [SECURITY](.github/SECURITY.md). How we measure up against the OpenSSF best-practices checklist: [docs/checklists/OPENSSF_BEST_PRACTICES.md](docs/checklists/OPENSSF_BEST_PRACTICES.md).

## License

Proprietary. Copyright (c) 2026 Quill & Cup LLC. All rights reserved. The source is public for transparency only and no license to use, copy, modify or distribute it is granted; see [LICENSE](LICENSE). Third-party packages keep their own licenses.
