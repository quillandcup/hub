# Governance

Hedgie Hub is owned and run by Quill & Cup LLC. This page says who decides what, how changes get in and how the project keeps going if someone is unavailable.

## Roles

- **Owners** (two people): own the repository and the production accounts (GitHub, Vercel, Supabase and the provider accounts listed in `docs/SECRET_ROTATION.md`), set the roadmap and make the final call on scope, security and licensing.
- **Maintainer**: has write access, reviews and ships changes, answers issues and security reports. Today one owner does the day-to-day maintaining.
- **Contributor**: anyone who opens an issue. Outside code contributions are not accepted for now (`CONTRIBUTING.md`).

## How changes are made

All changes land through a pull request. Required checks (unit and database tests, build, coverage on new lines, migration ordering, CodeQL) must pass and every review thread must be resolved; the `main` ruleset in `github-repo-config.yml` enforces it, administrators included. Approvals are not required, because the maintainer team is one person; automated review, tests and the scanners listed in `docs/THREAT_MODEL.md` stand in. Auto-merge is only enabled for pull requests by Dependabot and by the repository's owner, members and collaborators.

Two-factor authentication is required for the GitHub organization, Vercel and Supabase.

## Roadmap

The plan and the list of known gaps are in `docs/TODO.md`; what members have received is in the changelog (`docs/CHANGELOG_PROCESS.md`).

## Continuity

Everything needed to run and recover the project is in the repository: setup (`docs/SETUP.md`), deployment (`docs/DEPLOYMENT.md`), credentials and how to rotate them (`docs/SECRET_ROTATION.md`), and the data model (`docs/MEDALLION_ARCHITECTURE.md`). Secrets are kept in the hosting providers and environment files, never in the repository. Two owners hold administrator access on each primary production account (GitHub, Vercel and Supabase), so either can run and recover the project if the other is unavailable.

## Security reports

Reports come in privately (`SECURITY.md`). The maintainer acknowledges within 14 days, fixes confirmed problems on a branch with tests, ships them through the normal pull request path, and credits the reporter in the advisory unless they prefer not to be named. Fixed issues in dependencies are tracked by Dependabot and `pnpm audit`.
