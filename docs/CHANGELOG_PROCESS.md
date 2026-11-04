# Changelog

What's new and fixed in the Hedgie Hub, for members. One source, three readers.

- **Source:** `lib/changelog/entries.ts`, a typed list. Add an entry in the same PR as the change it describes, so it goes live with the deploy that ships the feature.
- **In the app:** `/changelog` (list) and `/changelog/<slug>` (one entry, with its own link), reached from the **?** menu in the top bar.
- **In the repo:** `CHANGELOG.md`, generated with `pnpm changelog:generate`. `tests/lib/changelog.test.ts` fails when it is stale or an entry is malformed.
- **Coming next:** a weekly "What's new" digest through the notification channels (members choose how), and a post to the announcements Slack channel.

## Writing an entry

- `category`: `new`, `improved` or `fixed`. Only things a member would notice; skip refactors and internal tooling.
- `summary`: one or two plain sentences, no markdown (it is the excerpt in the list, digests and Slack). Say what the member can now do.
- `body`: markdown. Link Hub pages as `/path`.
- `slug`: the permalink. Never change it after publishing.
- Dates are the Eastern day it shipped.

## Screenshots

Put images in `public/changelog/<slug>/` and reference them as `/changelog/<slug>/<file>.png` in `body` (and in `image` for the one shown on the list). The repo and that folder are public: use sample data, never a real member's name, photo or message. Images must live in the entry's own folder; the validator rejects anything else.
