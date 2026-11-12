import type { FeatureKey } from "@/lib/features";

/**
 * Feature flags that are on for everyone, for the changelog drafter (`pnpm changelog:draft`): a pull request that names
 * a flag not listed here is held back until the flag is live, because a feature behind a flag is not a product update
 * yet. CI cannot read the production database, so this is a committed list. Add a key in the same pull request as the
 * feature's changelog entry, after reading the day the flag went on for everyone from the audit log
 * (docs/CHANGELOG_PROCESS.md, "Writing an entry"). A flag that is removed from `lib/features.ts` is live by definition:
 * delete its key here too (`tests/lib/changelog-live-flags.test.ts` fails on a key that no longer exists).
 */
export const LIVE_FLAGS: readonly FeatureKey[] = ["chat_link_previews"];
