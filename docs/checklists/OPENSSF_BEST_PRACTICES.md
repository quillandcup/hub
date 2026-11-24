# OpenSSF Best Practices: where we stand

> **Status:** living. **Last reviewed:** 2026-11-23. Review: quarterly. Kept up to date with the code; if it is wrong, fix it.

Where the project stands against the OpenSSF Best Practices criteria, used as a guide to good practice rather than for a badge. The OpenSSF Best Practices badge (bestpractices.dev) is a self-assessed checklist at three levels. **We are not applying for the badge**: the Passing level requires a FLOSS license and ours is proprietary (`LICENSE`). This page uses the checklist as a list of good practice and records how we score, so we know what is already done and what is worth doing anyway.

**The source of truth is OpenSSF's own criteria**, which change over time; if this page disagrees with them, they win:
[Passing](https://www.bestpractices.dev/en/criteria/0) · [Silver](https://www.bestpractices.dev/en/criteria/1) · [Gold](https://www.bestpractices.dev/en/criteria/2) · [source text](https://github.com/coreinfrastructure/best-practices-badge/blob/main/docs/criteria.md) and [Silver/Gold text](https://github.com/coreinfrastructure/best-practices-badge/blob/main/docs/other.md).

Last assessed 2026-11-20 against the criteria as published that day. A different tool, the [OpenSSF Scorecard](https://scorecard.dev/viewer/?uri=github.com/quillandcup/hub), grades automatically; see `docs/TODO.md`, "External security scanners: what is left" for its findings. The newer [OSPS Baseline](https://baseline.openssf.org) is mapped control by control in `docs/checklists/OSPS_BASELINE.md`.

**Status words.** *Met*: done, with where to look. *Partly*: some of it. *Not met*. *N/A*: the criterion doesn't apply (for example, no native binaries). *Unverified*: believed true but not checked against the repo or the live setting. A level word in brackets is the criterion's own: MUST, SHOULD or SUGGESTED. Names in `code font` are the criterion ids on bestpractices.dev.

## Summary

| Level | Result |
|---|---|
| Passing | Blocked by one MUST we can't meet without relicensing (`floss_license`). Apart from that: a few gaps (release identifiers and notes, lint warnings not at zero, a few unverified items); the rest is met or N/A. |
| Silver | Roughly half met. Gaps: no DCO or CLA, no signed releases, no reproducible build, a roadmap that is a backlog and not a one-year plan, bus factor of one developer. |
| Gold | Not reachable as a solo project: two unassociated contributors, review of at least half the changes by someone else, reproducible builds. Several other items are met or close. |

## Passing

### Basics
| Criterion | Status | Evidence or gap |
|---|---|---|
| `homepage_url` [MUST] | Met | Public repository and `README.md`; the production site is public. |
| `description_good` [MUST] | Met | `README.md` opens with what the software is for. |
| `interact` [MUST] | Met | `README.md` links `.github/CONTRIBUTING.md` (feedback, what we accept), `.github/SUPPORT.md` is where members ask for help, and `.github/SECURITY.md` is for security reports. |
| `contribution` [MUST] | Met | `.github/CONTRIBUTING.md`. It says outside code is not accepted for now. |
| `contribution_requirements` [SHOULD] | Met | `.github/CONTRIBUTING.md` and `.claude/rules/`. |
| `floss_license` [MUST] | **Not met** | Proprietary, all rights reserved. The blocker for the badge. |
| `floss_license_osi` [SUGGESTED] | Not met | Same. |
| `license_location` [MUST] | Met | `LICENSE` in the repository root. |

### Documentation
| Criterion | Status | Evidence or gap |
|---|---|---|
| `documentation_basics` [MUST] | Partly | Setup and use for developers: `README.md`, `docs/runbooks/SETUP.md`. Member-facing help is in the app (`/help`). |
| `documentation_interface` [MUST] | Partly | Routes and data access are documented in `docs/` and `.claude/rules/`; there is no generated API reference. |

### Other
| Criterion | Status | Evidence or gap |
|---|---|---|
| `sites_https` [MUST] | Met | GitHub and the production site are HTTPS only. |
| `discussion` [MUST] | Met | GitHub issues and pull requests (public, searchable, no special client). |
| `english` [SHOULD] | Met | |
| `maintained` [MUST] | Met | Scorecard "Maintained" is 10/10. |

### Change control
| Criterion | Status | Evidence or gap |
|---|---|---|
| `repo_public`, `repo_track`, `repo_interim` [MUST] | Met | Public git repository with full history. |
| `repo_distributed` [SUGGESTED] | Met | git. |
| `version_unique` [MUST] | Partly | We deploy continuously; each deploy is a commit SHA and the `production` tag marks what is live (`docs/infrastructure/DEPLOYMENT.md`). There are no numbered releases (`package.json` stays at 0.1.0). |
| `version_semver`, `version_tags` [SUGGESTED] | Not met | No versions. The `production` tag moves rather than naming releases. |
| `release_notes` [MUST, N/A allowed for continuously delivered sites] | Partly | The changelog (`src/content/changelog.ts`, `docs/runbooks/CHANGELOG_PROCESS.md`) is the human-readable record; it is per feature, not per release. |
| `release_notes_vulns` [MUST, N/A allowed] | Partly | Security fixes are not called out in the changelog; they appear in pull requests and, for reports, in advisories. |

### Reporting
| Criterion | Status | Evidence or gap |
|---|---|---|
| `report_process`, `report_tracker`, `report_archive` | Met | GitHub issues are on; `.github/CONTRIBUTING.md`, `.github/SUPPORT.md`. |
| `report_responses` [MUST], `enhancement_responses` [SHOULD] | Unverified | Almost no issue activity so far, so there is little to respond to. |
| `vulnerability_report_process`, `vulnerability_report_private` [MUST] | Met | `.github/SECURITY.md`; private vulnerability reporting is enabled on the repository. |
| `vulnerability_report_response` [MUST, N/A allowed] | N/A | No reports in the last 6 months. `.github/GOVERNANCE.md` commits to acknowledging within 14 days. |

### Quality
| Criterion | Status | Evidence or gap |
|---|---|---|
| `build`, `build_common_tools`, `build_floss_tools` | Met | `pnpm build` (Next.js), standard Node tooling. |
| `test`, `test_invocation` | Met | Vitest and pgTAP (`pnpm test:unit`, `pnpm test:db`, `pnpm test:pgtap`), documented in `CLAUDE.md`. |
| `test_most` [SUGGESTED] | Met | Coverage floors per area and 80% on new lines (`scripts/coverage-report.ts`). |
| `test_continuous_integration` [SUGGESTED] | Met | `.github/workflows/ci.yml`. |
| `test_policy`, `tests_are_added`, `tests_documented_added` | Met | `.claude/rules/tests-with-every-change.md`; the patch-coverage check enforces it on every PR; `.github/CONTRIBUTING.md` points to it. |
| `warnings`, `warnings_fixed` [MUST] | Partly | TypeScript is `strict` and ESLint runs in CI with zero errors, but about 1,300 lint warnings are open. |
| `warnings_strict` [SUGGESTED] | Partly | Same. Turning warnings into errors rule by rule is the way up. |

### Security
| Criterion | Status | Evidence or gap |
|---|---|---|
| `know_secure_design`, `know_common_errors` [MUST] | Unverified | A self-attestation about the developers; `docs/trust/THREAT_MODEL.md` and `docs/trust/RLS_SECURITY.md` are the evidence. |
| `crypto_*` (published, call, FLOSS, keylength, working, weaknesses, pfs, password storage, random) | N/A | No cryptography of our own; TLS and password-less sign-in are provided by Vercel and Supabase. Provider tokens we store are encrypted (`docs/TODO.md`, "Secrets at Rest"). |
| `delivery_mitm` [MUST] | Met | HTTPS everywhere. |
| `delivery_unsigned` [MUST NOT] | Met | Nothing fetches a hash over HTTP. |
| `vulnerabilities_fixed_60_days` [MUST] | Met | The weekly OSV-Scanner run passed on 2026-11-23; it accepts two advisories with no published fix, in a dev-only dependency of the Vercel CLI, with an expiry (`config/osv-scanner.toml`); Dependabot weekly. |
| `vulnerabilities_critical_fixed` [SHOULD] | Met | Same. |
| `no_leaked_credentials` [MUST NOT] | Met | Secrets live outside the repo (`.claude/rules/public-repo-hygiene.md`, `docs/runbooks/SECRET_ROTATION.md`) and gitleaks scans the full history. Triaged 2026-11-20: 22 of 23 findings are the public local Supabase demo keys and fake test values; the other was a database password in an early deployment doc, rotated long ago (owner-confirmed). No valid credential is in the repository. |

### Analysis
| Criterion | Status | Evidence or gap |
|---|---|---|
| `static_analysis`, `static_analysis_common_vulnerabilities`, `static_analysis_often` | Met | CodeQL on every pull request (a required check) plus ESLint. |
| `static_analysis_fixed` [MUST] | Met | CodeQL is required to merge. |
| `dynamic_analysis` [SUGGESTED] | Partly | A passive ZAP baseline runs weekly against production; there is no active scan. The first results (no failures, 10 warning types) are triaged in `docs/TODO.md`. |
| `dynamic_analysis_unsafe` | N/A | Memory-safe language. |
| `dynamic_analysis_enable_assertions` [SUGGESTED] | Unverified | |
| `dynamic_analysis_fixed` [MUST] | Met | The first ZAP baseline (2026-11-20) had no failures and 10 warnings; the worthwhile ones are tracked in `docs/TODO.md` and the CSP ones are being fixed. |

## Silver
Silver also requires every Passing criterion, and promotes several SHOULD or SUGGESTED ones to MUST.

| Criterion | Status | Evidence or gap |
|---|---|---|
| `dco` [SHOULD] | Not met | No DCO or CLA. Reason outside code is not accepted. |
| `code_of_conduct`, `governance`, `roles_responsibilities` [MUST] | Met | `.github/CODE_OF_CONDUCT.md`, `.github/GOVERNANCE.md`. |
| `documentation_roadmap` [MUST] | Partly | `docs/TODO.md` is a backlog, not a one-year plan. |
| `documentation_architecture` [MUST] | Met | `docs/architecture/MEDALLION_ARCHITECTURE.md`, `docs/architecture/ERD.md`, `docs/architecture/SEQUENCE_DIAGRAMS.md`. |
| `documentation_security` [MUST] | Partly | `docs/trust/THREAT_MODEL.md` has the threat model and a review; there is no explicit assurance case. |
| `documentation_quick_start` [MUST] | Met | `docs/runbooks/SETUP.md`. |
| `documentation_current` [MUST] | Partly | Docs are maintained with changes but not checked for drift. |
| `documentation_achievements` [MUST] | Met | Scorecard and scan badges on `README.md` (there is no OpenSSF badge). |
| `sites_password_security` | N/A | The project's sites store no external passwords. |
| `accessibility_best_practices` [SHOULD] | Partly | An accessibility check exists for landing pages; not audited elsewhere. |
| `internationalization` [SHOULD] | Not met | English only. |
| `access_continuity` [MUST] | Met | Two owners on GitHub, Vercel and Supabase (`.github/GOVERNANCE.md`). Provider accounts beyond those three are not checked. |
| `bus_factor` [SHOULD] | Partly | Two people can administer; one does the development. |
| `maintenance_or_update` | N/A | One deployed version; there are no older releases to maintain. |
| `vulnerability_report_credit`, `vulnerability_response_process` | Met | `.github/GOVERNANCE.md`, `.github/SECURITY.md`. |
| `automated_integration_testing` [MUST] | Met | CI on every push and pull request, with a pass/fail report. |
| `test_policy_mandated` [MUST] | Met | `.claude/rules/tests-with-every-change.md`. |
| `regression_tests_added50` [MUST] | Unverified | The rule is "bug fixes start with a failing test"; the 6-month share isn't measured. |
| `test_statement_coverage80` [MUST] | Partly | Floors are 92% statements for `lib`, 86% for `components`, 79% for `src/app/api`, and new lines must reach 80%. The combined number isn't published. |
| `coding_standards`, `coding_standards_enforced` [MUST] | Met | `.claude/rules/`, ESLint and TypeScript in CI. |
| `external_dependencies`, `updateable_reused_components` [MUST] | Met | `package.json`, `pnpm-lock.yaml`, Dependabot. |
| `interfaces_current` [SHOULD] | Unverified | |
| `build_standard_variables`, `build_preserve_debug`, `build_non_recursive`, `installation_standard_variables` | N/A | No native build or install system. |
| `build_repeatable` [MUST] | Not met | `deploy.yml` stamps each build with the run id, so no two builds are identical. Making it repeatable means removing that and checking the output matches. |
| `installation_common`, `installation_development_quick` [MUST] | Met | `pnpm install`, then the local stack (`docs/runbooks/SETUP.md`). |
| `implement_secure_design` [MUST] | Met | Row level security on every table, admin guards, a test per rule (`docs/trust/RLS_SECURITY.md`). |
| `input_validation` [MUST] | Partly | Sanitizers and validation exist; their allow-lists are listed as not reviewed in `docs/trust/THREAT_MODEL.md`. |
| `hardening` [SHOULD] | Partly | Security headers are set (`next.config.ts`); the CSP for scripts and styles is report-only. |
| `crypto_algorithm_agility` | N/A | |
| `crypto_credential_agility` [MUST] | Met | Credentials are environment variables and vault entries, not code. |
| `crypto_used_network`, `crypto_tls12`, `crypto_certificate_verification`, `crypto_verification_private` | Met | Platform defaults (Vercel, Supabase, Node). |
| `signed_releases`, `version_tags_signed` | Not met | No releases. |
| `dependency_monitoring` [MUST] | Met | Dependabot, OSV-Scanner (weekly, and a required check on every pull request). |

## Gold
Gold also requires Silver.

| Criterion | Status | Evidence or gap |
|---|---|---|
| `bus_factor` [MUST] | Not met | One developer. |
| `contributors_unassociated` [MUST] | Not met | No outside contributors. |
| `small_tasks` [MUST] | Not met | Needs contributors to be useful. |
| `two_person_review` [MUST] | Not met | The `main` ruleset requires zero approvals (a deliberate choice for a one-developer repository); review is by CI and scanners. |
| `code_review_standards` [MUST] | Partly | Review threads must be resolved and checks pass; written review criteria aren't documented. |
| `copyright_per_file`, `license_per_file` [MUST] | Not met | Only `LICENSE` and `README.md` state the holder; source files carry no header. |
| `require_2FA` [MUST] | Met | Enforced for GitHub, Vercel and Supabase (owner-reported). |
| `secure_2FA` [SHOULD] | Unverified | Whether the second factor is an authenticator or passkey, not SMS. |
| `repo_distributed`, `test_invocation`, `test_continuous_integration` [now MUST] | Met | |
| `hardening` [MUST] | Partly | As at Silver. |
| `crypto_used_network`, `crypto_tls12` [now MUST] | Met | |
| `dynamic_analysis` [MUST] | Partly | As at Passing. |
| `build_reproducible` [MUST] | Not met | See `build_repeatable`. |
| `test_statement_coverage90` [MUST] | Not met | Floors are 79 to 92% by area; the combined figure is unmeasured. |
| `test_branch_coverage80` [MUST] | Partly | Floors are 85% for `lib`, 82% for `components` and 71% for `src/app/api`. |
| `security_review` [MUST] | Partly | `docs/trust/THREAT_MODEL.md` (2026-11-17) is our own review, not an independent one. |
| `hardened_site` [MUST] | Unverified | Headers are set; Observatory and securityheaders grades haven't been run (`docs/TODO.md`). |

## What is worth doing even without the badge
Ordered by value for effort; each is, or should become, an entry in `docs/TODO.md`.

1. Re-run the ZAP baseline after the next deploy and check the warnings left are only the informational ones (`config/zap-baseline.tsv` lists what is accepted and why); the gitleaks, OSV and ZAP first results are triaged.
2. Take the lint warnings to zero, rule by rule, then make the rules errors (`warnings_fixed`, `warnings_strict`).
3. Run the Observatory and securityheaders checks and enforce the CSP for scripts and styles (`hardening`, `hardened_site`).
4. Publish the combined coverage figure in the CI report, and raise the `src/app/api` floor.
5. Write a one-year roadmap from the backlog (`documentation_roadmap`).
6. Add per-file license headers (`copyright_per_file`, `license_per_file`), if we ever want them; this is cosmetic while the repository is proprietary.
7. Property-based tests on the sanitizers and importers (also lifts the Scorecard Fuzzing check).

Not within reach without a decision or another person: a FLOSS license, a DCO or CLA, outside contributors, independent review of changes, and reproducible builds.
