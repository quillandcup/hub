# Security policy

## Reporting a vulnerability

Please report it privately, not in a public issue or pull request:

1. Open [Report a vulnerability](https://github.com/quillandcup/hub/security/advisories/new) (the repository's **Security** tab, then **Report a vulnerability**).
2. Say what you found, where, and the steps to reproduce it. A proof of concept helps; please don't read, change or delete data that isn't yours while testing.

You will get an acknowledgement within a few days, and we will keep you updated until it is fixed. We will credit you in the advisory if you want that.

## What is in scope

The Hub application in this repository and its production deployment. Secrets, member data and credentials should never be in this repository (it is public); if you find any, report it the same way so it can be rotated.

## Supported versions

Only the current production deployment (the `main` branch) is supported. There are no versioned releases.

## How fast findings are fixed

A finding is a vulnerable dependency (Dependabot alert, OSV-Scanner), a dependency with an unapproved license, or a static analysis alert (CodeQL). The time to fix is counted from the day the finding is first reported against the code we run. The severity is the one the scanner or advisory gives, raised one level when the vulnerable code is reachable from the production app or the advisory is known to be exploited.

### Dependencies (software composition analysis)

- Vulnerabilities found by dependency scanning (software composition analysis) must be fixed or mitigated within 10 days when critical, within 30 days when high, within 60 days when medium and within 90 days when low.
- A dependency with an unapproved license must be removed, replaced or recorded as an exception within 30 days when it is in production and within 60 days when it is only used for development.
- Approved licenses and recorded license exceptions are listed in `config/license-policy.json`, and accepted vulnerabilities in `config/osv-scanner.toml`. Each entry has a reason and an expiry date.

### Static analysis

- CodeQL code scanning (static analysis) runs on every pull request, and a new alert in a pull request blocks the merge.
- Critical and high severity code scanning findings must be fixed within 10 days and 30 days, and medium and low severity findings within 60 days and 90 days.

### Meaning of the targets, exceptions and what is enforced

- **Fixed** means the dependency is upgraded or removed, or the code is changed. **Mitigated** means the risk is removed without that (a feature switched off, an input blocked) and the real fix is tracked in `docs/TODO.md`.
- **No fix published.** A finding with no fixed version is recorded with a reason and an expiry no later than its deadline above in `config/osv-scanner.toml`, so the scheduled run fails again on that date and someone looks at it. A finding in a development-only dependency that never reaches the production build can be recorded the same way, saying so. Each accepted finding is also published as an [OpenVEX](https://github.com/openvex/spec) statement in `config/vex.openvex.json` (`not_affected` with justification `component_not_present` for the development-only ones, `affected` for one with no fix); `pnpm vex` generates it from `config/osv-scanner.toml` and `tests/lib/vex.test.ts` fails when it is out of date.
- **What is enforced.** A new CodeQL alert blocks the merge (a required check). A pull request that introduces a vulnerable dependency version fails the `OSV diff / osv-scan` check (a required check on `main`). A vulnerability already on `main` is only reported by the scheduled scan (`osv-scan.yml`, any severity). Nothing computes a deadline: the targets are what the maintainers hold themselves to. A missed one stays visible because the scheduled scan fails and posts to the alerts channel every week a finding stays open, and because an accepted finding expires. A finding past its deadline that is still open goes in `docs/TODO.md` with the reason and a new date.
- **Dependabot security updates** open the pull request as soon as an advisory lands (`auto-merge.yml` merges only patch and minor ones; a major always waits for a person), so for most findings the time to fix is the time to review and merge.
- **Licenses.** `license-scan.yml` checks every installed package against `config/license-policy.json` each week. The app is hosted, not distributed, so copyleft duties that arise on distribution (LGPL, MPL) are not triggered, and the approved list is still limited to permissive licenses (MIT, ISC, Apache-2.0, BSD, 0BSD, BlueOak, CC0) plus MPL-2.0 (file-level copyleft), and `Python-2.0` for development-only packages. Strong copyleft (GPL, AGPL, SSPL) and undeclared licenses are findings in production and in development. An exception carries a reason and an expiry of at most 12 months, and the package is a finding again when it passes. The weekly scan reports and gates nothing: a pull request that adds such a dependency is not blocked.
- **Who.** The maintainers. The weekly scanner runs and Dependabot alerts are how a finding reaches them.

## More

How the application is protected, and what is known and tracked, is in [`docs/trust/THREAT_MODEL.md`](../docs/trust/THREAT_MODEL.md).
