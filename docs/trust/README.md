# Trust

Security and privacy posture.

<!-- START docs-index generated: run `pnpm docs:index` to update, don't edit by hand -->

- [Photos on milestones: security review](MILESTONE_PHOTOS_REVIEW.md): Security review of the photos members can add to milestones and Bookshelf books, with each design decision and the test that pins it
- [Row Level Security (RLS) Implementation](RLS_SECURITY.md): How Row Level Security is set up for the Hedgie Hub: roles, table policies, helper functions and the guards that keep them in place
- [Addresses in stored HTML: what production uses, and what the sanitizers now allow](SANITIZER_URL_CHECK.md): Check of which addresses production's stored HTML actually uses, done before the sanitizers stopped allowing relative addresses
- [SECURITY DEFINER function review](SECURITY_DEFINER_REVIEW.md): Review of every SECURITY DEFINER function that signed-in users can call, checking each for a caller check and for dynamic SQL
- [Staff two-step sign-in (TOTP)](STAFF_MFA.md): How staff accounts are protected by a second sign-in step, a 6-digit code from an authenticator app
- [Threat model and OWASP Top 10 review](THREAT_MODEL.md): Threat model and OWASP Top 10 review of the Hub: what is protected, who might attack it and what stops them

<!-- END docs-index -->
