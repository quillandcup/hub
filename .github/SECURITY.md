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

## More

How the application is protected, and what is known and tracked, is in [`docs/trust/THREAT_MODEL.md`](../docs/trust/THREAT_MODEL.md).
