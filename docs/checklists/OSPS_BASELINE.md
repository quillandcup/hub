# OSPS Baseline: where we stand

> **Status:** living. **Last reviewed:** 2026-11-23. Review: quarterly. Kept up to date with the code; if it is wrong, fix it.

Where the project stands against each control of the OpenSSF Open Source Project Security Baseline. The [Open Source Project Security Baseline](https://baseline.openssf.org) (OSPS Baseline, from the OpenSSF) is a list of security controls in three maturity levels: **Level 1** for any project, **Level 2** for a code project with at least two maintainers and a few consistent users, **Level 3** for a code project with many consistent users. This page maps each control to the repository and the live settings, so we know what is done and what is worth doing. It sits beside `docs/checklists/OPENSSF_BEST_PRACTICES.md`, which covers the older Best Practices badge; the Baseline overlaps with it and with the Scorecard.

**Assessed 2026-11-23** against the catalog in `github.com/ossf/security-baseline`: release `v2026.08.28` (the latest tagged), with the `main` branch as of 2026-10-29 (the catalog still marks itself draft). It has 8 families and 65 active controls (two more are retired: `OSPS-BR-01.02` and `OSPS-VM-05.01`). **The source of truth is OpenSSF's text**, which changes; if this page disagrees with it, it wins. Control ids and the level word below are theirs.

**Status words.** *Met*: done, with where to look. *Partly*: some of it. *Not met*. *N/A*: the control doesn't apply. Many controls begin "when the project has made a release". We have no versioned releases: the app is deployed continuously from `main` and the `production` tag marks what is live (`docs/infrastructure/DEPLOYMENT.md`), so those are N/A for now, and become real if we ever publish release assets. Live settings were read with `gh api` on the assessment date.

## Summary

| Result | Count |
|---|---|
| Met | 42 |
| Partly | 5 |
| Not met | 3 |
| N/A | 15 |
| Total | 65 |

**Level 1** (24 controls): all met or N/A except `OSPS-LE-02.01`, which needs relicensing. **Level 2** adds `OSPS-LE-01.01` (a DCO or CLA, not met, because we accept no outside code) and a few documentation gaps. **Level 3** is out of reach as a one-developer project (`OSPS-QA-07.01` needs a second human approver), plus some policy documents we have not written (see `docs/TODO.md`, "OSPS Baseline: what is left").

## Access control (AC)

| Control | Level | Status | Evidence or gap |
|---|---|---|---|
| `OSPS-AC-01.01` MFA for sensitive resources | 1 | Met | Two-factor is required for the GitHub organization (read live: `two_factor_requirement_enabled`). Vercel and Supabase are owner-reported (`.github/GOVERNANCE.md`). |
| `OSPS-AC-02.01` New collaborators get the lowest permission | 1 | Met | The organization's default repository permission is `read` (live); collaborators are added by hand by an owner (`.github/GOVERNANCE.md`, "Access"). |
| `OSPS-AC-03.01` Direct commits to the primary branch are blocked | 1 | Met | The `main` ruleset requires a pull request (`config/github.yml`); the only bypass is the admin role, and only through a pull request. |
| `OSPS-AC-03.02` Deleting the primary branch is prevented | 1 | Met | The `deletion` and `non_fast_forward` rules in the same ruleset. |
| `OSPS-AC-04.01` Default CI permissions are the lowest | 2 | Met | Every workflow in `.github/workflows/` declares a top-level `permissions:` (read-only; writes only on the jobs that need them), and the repository default for the token is `read` (live, set 2026-11-23: `gh api repos/quillandcup/hub/actions/permissions/workflow`). |
| `OSPS-AC-04.02` Each job gets the minimum it needs | 3 | Met | Top-level `read` and per-job grants (`openssf-scorecard.yml`, `deploy.yml`, `ci.yml`); no workflow has write at the top level. |

## Build and release (BR)

| Control | Level | Status | Evidence or gap |
|---|---|---|---|
| `OSPS-BR-01.01` Untrusted metadata is sanitized in CI | 1 | Met | No workflow uses `pull_request_target` or `workflow_run`; event fields reach shell steps through `env:` (`ci.yml`), not interpolated into `run:`. |
| `OSPS-BR-01.03` Untrusted code gets no privileged credentials | 1 | Met | Workflows run on `pull_request`, which gives fork PRs no secrets; auto-merge and preview cleanup are limited to same-repository PRs (`auto-merge.yml`). Outside code is not accepted anyway (`.github/CONTRIBUTING.md`). |
| `OSPS-BR-01.04` Trusted collaborator input is sanitized in CI | 3 | Met | Same as `OSPS-BR-01.01`. |
| `OSPS-BR-02.01` Releases get a unique version id | 2 | N/A | No official releases; each deploy is a commit SHA. See `version_unique` in the Best Practices checklist. |
| `OSPS-BR-02.02` Release assets tied to the release id | 3 | N/A | No release assets. |
| `OSPS-BR-03.01` Official channels are encrypted | 1 | Met | The repository, the production site and the Vercel deployment are HTTPS only. |
| `OSPS-BR-03.02` Distribution channels resist adversary-in-the-middle | 1 | Met | The only distribution channel is the HTTPS production site (Vercel TLS). |
| `OSPS-BR-04.01` Releases carry a change log | 2 | N/A | No releases. The changelog (`src/content/changelog.ts`) is per feature. |
| `OSPS-BR-05.01` Dependencies come through standard tooling | 2 | Met | pnpm with `pnpm-lock.yaml` and frozen installs in CI. One exception: `deploy.yml` runs `npm install -g vercel` before any install (`docs/TODO.md`, "External security scanners: what is left"). |
| `OSPS-BR-06.01` Releases signed or in a signed manifest | 2 | N/A | No releases. Build provenance for deploys is separate work, not assessed here. |
| `OSPS-BR-07.01` Secrets are kept out of version control | 1 | Met | GitHub secret scanning and push protection are on (live); gitleaks scans the full history (`.github/workflows/gitleaks.yml`, `config/.gitleaksignore`); `.claude/rules/public-repo-hygiene.md`. |
| `OSPS-BR-07.02` A policy for managing secrets | 3 | Met | `docs/runbooks/SECRET_ROTATION.md`, `config/env-vars.ts` (what is secret and where it lives). |

## Documentation (DO)

| Control | Level | Status | Evidence or gap |
|---|---|---|---|
| `OSPS-DO-01.01` User guides for basic functionality | 1 | Met | Member help is in the app (`/help`, Hedgie Help); developer setup is `docs/runbooks/SETUP.md`. The control only applies once a release is made, but the guides exist either way. |
| `OSPS-DO-02.01` A guide for reporting defects | 1 | Met | `.github/CONTRIBUTING.md`, `.github/SUPPORT.md`, `.github/SECURITY.md`. The control only applies once a release is made, but the guides exist either way. |
| `OSPS-DO-03.01` How to verify release assets | 3 | N/A | No releases. |
| `OSPS-DO-03.02` How to verify who authored a release | 3 | N/A | No releases. |
| `OSPS-DO-04.01` Scope and duration of support per release | 3 | N/A | No releases. `.github/SECURITY.md` says only the current production deployment is supported. |
| `OSPS-DO-05.01` When a version stops getting security updates | 3 | N/A | One deployed version. |
| `OSPS-DO-06.01` How dependencies are chosen and tracked | 2 | Met | `.github/GOVERNANCE.md`, "Dependencies"; `.github/dependabot.yml`. |
| `OSPS-DO-07.01` How to build the software | 2 | Met | `README.md`, `docs/runbooks/SETUP.md`, `CLAUDE.md` (commands). |

## Governance (GV)

| Control | Level | Status | Evidence or gap |
|---|---|---|---|
| `OSPS-GV-01.01` List of members with access to sensitive resources | 2 | Partly | `.github/GOVERNANCE.md` names the roles and says two owners hold admin on GitHub, Vercel and Supabase; the names are not in the repository because it is public. The list is the collaborators page and each provider's members. |
| `OSPS-GV-01.02` Roles and responsibilities | 2 | Met | `.github/GOVERNANCE.md`, "Roles". |
| `OSPS-GV-02.01` Public discussion of changes and obstacles | 1 | N/A | Proprietary project that takes no outside contributions, so changes are not discussed publicly the way an open source project's are. Issues and pull requests are readable on GitHub, but that is transparency, not a discussion mechanism. |
| `OSPS-GV-03.01` Contribution process, or a statement that none is accepted | 1 | Met | `.github/CONTRIBUTING.md` says outside code is not accepted for now. |
| `OSPS-GV-03.02` Guide for code contributors | 2 | Met | `.github/CONTRIBUTING.md`, "For people on the team", and `.claude/rules/`. |
| `OSPS-GV-04.01` Collaborators are reviewed before getting elevated access | 3 | Met | `.github/GOVERNANCE.md`, "Access". |

## Legal (LE)

| Control | Level | Status | Evidence or gap |
|---|---|---|---|
| `OSPS-LE-01.01` Contributors assert the right to contribute (DCO or CLA) | 2 | Not met | None; outside code isn't accepted, so there is nothing to attest. Needed if that changes. |
| `OSPS-LE-02.01` Source license meets the OSI or FSF definition | 1 | Not met | Proprietary, all rights reserved (`LICENSE`). A relicensing decision, not a gap to patch. |
| `OSPS-LE-02.02` Released assets under such a license | 1 | N/A | No released assets; same blocker as above if there were. |
| `OSPS-LE-03.01` License in `LICENSE` in the repository | 1 | Met | `LICENSE` in the root. |
| `OSPS-LE-03.02` License alongside release assets | 1 | N/A | No release assets. |

## Quality (QA)

| Control | Level | Status | Evidence or gap |
|---|---|---|---|
| `OSPS-QA-01.01` Source is publicly readable at a static URL | 1 | Met | The public repository on GitHub. |
| `OSPS-QA-01.02` Public record of who changed what and when | 1 | Met | Git history, pull requests, squash merges. |
| `OSPS-QA-02.01` A list of direct dependencies | 1 | Met | `package.json` and `pnpm-lock.yaml`. |
| `OSPS-QA-02.02` Compiled release assets ship with an SBOM | 3 | N/A | No release assets. |
| `OSPS-QA-03.01` Status checks must pass on the primary branch | 2 | Met | The `main` ruleset requires `Test (unit)`, `Test (db) & build`, `Coverage report`, `Check migrations`, `Code quality gate`, `CodeQL` and `OSV diff / osv-scan` (`config/github.yml`; the last takes effect once the ruleset is pushed). An admin can override a PR by hand. |
| `OSPS-QA-04.01` Multiple repositories are listed | 1 | N/A | One repository. |
| `OSPS-QA-04.02` Subprojects as strict as the primary | 3 | N/A | One repository. |
| `OSPS-QA-05.01` No generated executables in version control | 1 | Met | `git ls-files` lists no executable or library binaries (checked 2026-11-23). |
| `OSPS-QA-05.02` No unreviewable binary artifacts | 1 | Met | The only binaries tracked are images and fonts under `public/` and `src/`; no archives or compiled code. |
| `OSPS-QA-06.01` An automated test suite runs before a commit is accepted | 2 | Met | `.github/workflows/ci.yml`: unit, database and pgTAP tests on every pull request, required. |
| `OSPS-QA-06.02` Test environments and invocation documented | 3 | Met | `CLAUDE.md` (commands), `docs/runbooks/SETUP.md`, `.claude/rules/testing-requirements.md`. |
| `OSPS-QA-06.03` Policy that major changes add or update tests | 3 | Met | `.claude/rules/tests-with-every-change.md`, enforced by the patch-coverage check (`scripts/coverage-report.ts`). |
| `OSPS-QA-07.01` One non-author human approval before merge | 3 | Not met | The ruleset requires zero approvals, on purpose for a solo maintainer with auto-merge; review is CI, CodeQL and the scanners (`.github/GOVERNANCE.md`). Needs a second maintainer. |

## Design and assessment (SA)

| Control | Level | Status | Evidence or gap |
|---|---|---|---|
| `OSPS-SA-01.01` Design docs showing all actions and actors | 2 | Partly | `docs/architecture/` (layers, ERD, sequence diagrams, permissions); not every action and actor is drawn. |
| `OSPS-SA-02.01` External interfaces described | 2 | Partly | Routes and webhooks are documented in `docs/` and `.claude/rules/`; no generated API reference. |
| `OSPS-SA-03.01` A security assessment | 2 | Met | `docs/trust/THREAT_MODEL.md` (our own review, not an independent one), `docs/trust/RLS_SECURITY.md`. |
| `OSPS-SA-03.02` Threat model and attack surface analysis | 3 | Partly | `docs/trust/THREAT_MODEL.md` has the model and per-category status; the attack-surface analysis of critical code paths is not separate. |

## Vulnerability management (VM)

| Control | Level | Status | Evidence or gap |
|---|---|---|---|
| `OSPS-VM-01.01` A coordinated disclosure policy | 2 | Met | `.github/SECURITY.md` and `.github/GOVERNANCE.md` (acknowledged within 14 days, fix by pull request, reporter credited). |
| `OSPS-VM-02.01` Security contacts in the docs | 1 | Met | `.github/SECURITY.md` points to GitHub private vulnerability reporting; no personal address is published. |
| `OSPS-VM-03.01` Private vulnerability reporting | 2 | Met | Private vulnerability reporting is enabled on the repository (live: `gh api repos/quillandcup/hub/private-vulnerability-reporting`). |
| `OSPS-VM-04.01` Publish data about discovered vulnerabilities | 2 | N/A | No reports so far; zero published advisories (live). The policy is to publish a GitHub advisory for a confirmed one. |
| `OSPS-VM-04.02` Non-affecting vulnerabilities in a VEX document | 3 | Partly | No VEX. Accepted findings are recorded with a reason and expiry in `config/osv-scanner.toml`. |
| `OSPS-VM-05.02` Policy to address SCA violations before release | 3 | Met | A pull request that introduces a vulnerable dependency fails the `OSV diff / osv-scan` check, which is a required check on `main` (live ruleset, read 2026-11-23; `OSPS-VM-05.03`); the policy text is `docs/trust/THREAT_MODEL.md`, "How fast findings are fixed". A pull request can still add an ignore for its own finding in `config/osv-scanner.toml`; that is tracked in `docs/TODO.md`. |
| `OSPS-VM-05.03` Dependency changes checked against a policy and blocked | 3 | Met | `osv-diff.yml` (OSV-Scanner diff mode) fails a pull request only on a vulnerability it introduces. It is a required check in `config/github.yml` and in the live `main` ruleset (read 2026-11-23, after `pnpm github:config:push`). Tested 2026-11-23, before it became required, on a throwaway PR (lodash 4.17.20 failed, a PR with no dependency change passed). |
| `OSPS-VM-05.04` Remediation threshold for vulnerable dependencies | 3 | Met | `docs/trust/THREAT_MODEL.md`, "How fast findings are fixed": Critical 10 days, High 30, Medium 60, Low 90. |
| `OSPS-VM-05.05` Remediation threshold for license findings | 3 | Met | `license-scan.yml` checks dependency licenses against `config/license-policy.json` weekly (informational, like the other scans); the threshold (30 days production, 60 days development only) is in `docs/trust/THREAT_MODEL.md`, "How fast findings are fixed". |
| `OSPS-VM-06.01` Remediation threshold for static analysis findings | 3 | Met | The same table covers CodeQL alerts; CodeQL also blocks new alerts in a pull request (required check). |
| `OSPS-VM-06.02` Automated enforcement against new weaknesses | 3 | Met | CodeQL is a required check on every pull request (`config/github.yml`), plus ESLint and TypeScript in CI. |

## What is worth doing

Nothing is left that only needs a decision or a setting; what remains is design work on the Partly rows (`OSPS-SA-01.01`, `-SA-02.01`, `-SA-03.02`, `-VM-04.02` and `OSPS-GV-01.01`).

Not within reach without a decision or another person: an open source license (`OSPS-LE-02.01`), a DCO or CLA (`OSPS-LE-01.01`) and a second human approver (`OSPS-QA-07.01`). Details and owners of the open items are in `docs/TODO.md`.
