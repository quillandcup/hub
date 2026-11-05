## changelog-writing

A change members can see ships with a changelog entry, in the same PR (`lib/changelog/entries.ts`, process in `docs/CHANGELOG_PROCESS.md`). The page, the weekly digest, the announcements post and `CHANGELOG.md` all read that one file.

**What gets an entry**
- **One story per feature, written when members can use it.** Many PRs make one thing members get: write one entry for it, dated the day it became available, benefit first, with what is in it as a short list. Not an entry per PR. Later improvements to something members already have are their own entries.
- **A feature behind a flag ships the day the flag goes on for everyone**, not when its code merged. Read that day from the production audit log (read-only, `verify-against-prod.md`): `audit_log` rows with `entity_type = 'feature_flag'` where `enabled_globally` goes true. A flag that is off for everyone is not a product update yet.
- **Milestones, demos and launch days are not entries** (nothing to bump). Write what members can do.
- **Two audiences.** `product` is what members see. `engineering` (platform, CI, tests, the data layer, or the low-level detail behind a product entry) appears only in `CHANGELOG.md`, never with screenshots.

**How to write it**
- The reader is a busy member on her phone, not a developer (`.claude/skills/member-reader-review`). Start with what she can now do, in one plain sentence; no developer words, no list of four features separated by commas.
- `summary` is one or two plain sentences with no markdown (it is the excerpt in the list, the digest and Slack). `body` is short.
- Say what a change does only as far as you have checked (PR body, diff, code, flags). Never claim "no AI", "private", "only you" or "automatically" without verifying it.
- For anything touching privacy or her account, one calm sentence: what is recorded, who sees it, how to turn it off (only what you have verified).
- Public repo: no names, emails, ids, tokens or internal channel names, in entries or screenshots.

**Before publishing a batch**: run the member reader review (`.claude/skills/member-reader-review`) and apply only the rewrites that stay true to the original and the code.

**Screenshots**: a `@changelog` demo scene and `pnpm changelog:capture <slug>` (small WebP, fictional demo community only). Look at every image before committing.
