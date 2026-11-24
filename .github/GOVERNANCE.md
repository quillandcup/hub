# Governance

Hedgie Hub is owned and run by Quill & Cup LLC. This page says who decides what, how changes get in and how the project keeps going if someone is unavailable.

## Roles

- **Owners** (two people): own the repository and the production accounts (GitHub, Vercel, Supabase and the provider accounts listed in `docs/runbooks/SECRET_ROTATION.md`), set the roadmap and make the final call on scope, security and licensing.
- **Maintainer**: has write access, reviews and ships changes, answers issues and security reports. Today one owner does the day-to-day maintaining.
- **Contributor**: anyone who opens an issue. Outside code contributions are not accepted for now (`CONTRIBUTING.md`).

## People with access to sensitive resources

The two owners, by GitHub handle:

- [`codyaray`](https://github.com/codyaray): owner of the GitHub organization, the Vercel team and the Supabase organization; the day-to-day maintainer.
- [`theaniassey`](https://github.com/theaniassey): owner of the GitHub organization, the Vercel team and the Supabase organization.

Nobody else holds administrator access on GitHub or Vercel (read from each provider's members list on 2026-11-24). The engineering team on GitHub (`@quillandcup/eng`) has write access to the repository. Each provider's own members page is the live record: the organization's people page on GitHub, **Team settings, Members** on Vercel and **Organization, Team** on Supabase. Access is granted and reviewed as described under "Access" below, and this list is updated in the same change.

## How changes are made

All changes land through a pull request. Required checks (unit and database tests, build, coverage on new lines, migration ordering, CodeQL) must pass and every review thread must be resolved; the `main` ruleset in `config/github.yml` enforces it, administrators included. Approvals are not required, because the maintainer team is one person; automated review, tests and the scanners listed in `docs/trust/THREAT_MODEL.md` stand in. Auto-merge is only enabled for pull requests by Dependabot and by the repository's owner, members and collaborators.

Two-factor authentication is required for the GitHub organization, Vercel and Supabase.

## Access

Access to sensitive resources (the repository's administration, the production accounts, the secrets in `docs/runbooks/SECRET_ROTATION.md`) is granted only by an owner, one person at a time, after the owners have reviewed who the person is and why they need it. New collaborators start with the lowest permission that does the job (the organization's default repository permission is read) and are raised only for a stated need; two-factor authentication is required first. Access is reviewed when someone's role changes and removed when they leave. The current list is the repository's collaborators page and the members of each provider account, not a document in the repository, because the repository is public.

## Dependencies

Dependencies are chosen by the maintainer when a change needs them and enter only through a pull request that changes `package.json` and `pnpm-lock.yaml`; installs in CI use the frozen lockfile. Dependabot proposes updates weekly (npm and GitHub Actions), and OSV-Scanner and CodeQL watch for known problems (`docs/trust/THREAT_MODEL.md`, "Scheduled scanners"). How fast a finding is fixed depends on its severity, from 10 days for a critical one to 90 for a low one (`.github/SECURITY.md`, "How fast findings are fixed").

## Roadmap

The plan and the list of known gaps are in `docs/TODO.md`; what members have received is in the changelog (`docs/runbooks/CHANGELOG_PROCESS.md`).

## Continuity

Everything needed to run and recover the project is in the repository: setup (`docs/runbooks/SETUP.md`), deployment (`docs/infrastructure/DEPLOYMENT.md`), credentials and how to rotate them (`docs/runbooks/SECRET_ROTATION.md`), and the data model (`docs/architecture/MEDALLION_ARCHITECTURE.md`). Secrets are kept in the hosting providers and environment files, never in the repository. Two owners hold administrator access on each primary production account (GitHub, Vercel and Supabase), so either can run and recover the project if the other is unavailable.

## Security reports

Reports come in privately (`SECURITY.md`). The maintainer acknowledges within 14 days, fixes confirmed problems on a branch with tests, ships them through the normal pull request path, and credits the reporter in the advisory unless they prefer not to be named. Fixed issues in dependencies are tracked by Dependabot and OSV-Scanner.
