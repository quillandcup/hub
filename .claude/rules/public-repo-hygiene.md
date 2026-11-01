## public-repo-hygiene

The repo is public, and so are its commit history, pull requests, PR descriptions and comments, and anything pushed to a branch (even one deleted later may be cached or forked). Once something is out, deleting it doesn't take it back, and the history rewrite that follows is expensive. So check before you write, not after.

**Never put these anywhere in the repo or on GitHub** (code, comments, tests and fixtures, docs, migrations, commit messages, PR titles and descriptions, review replies, issues):
- Real member or staff names, email addresses, phone numbers, birthdays, or anything that identifies a person.
- Non-public ids: calendar ids, Slack channel and user ids, Kajabi, Stripe or Zoom ids that belong to a real person or account, webhook URLs, tokens, keys.
- Exports and files: spreadsheets, CSVs, database dumps, query results with personal data, screenshots of member data.

**What to do instead**
- **Tests and fixtures**: obviously fake data (`member1@example.com`, "Ada Example"). Match the existing fixtures.
- **Docs and comments**: refer to the config by name, not value ("see `ALERTS_EMAIL` in `.env.prod`"), and describe incidents without naming people.
- **Config values** that aren't public go in the gitignored env files (`no hardcoded config`, `CLAUDE.md`), not in `app.config.ts`.
- **A one-off script that needs real names or emails** (a data migration, matching, awarding badges): run it locally against local or production, then delete it. Don't commit a "sanitized" copy. If a script has to stay, it takes its data from a file outside the repo or uses placeholders, like `scripts/seed-member-overrides.ts`. Migrations hold schema and definitions, never inserts for specific real people.
- **Data the user pastes into a prompt** (a table of members, a spreadsheet, a screenshot): use it for the task, but don't copy it into a file, a test, a commit or a PR. Summarize with counts. If the user says "do not store", that is final.
- **Production reads** (`verify-against-prod.md`): report counts and shapes, not rows.

**If something already got committed or pushed**: stop, don't add more commits over it, and tell the user what and where. Removing it from history is their call (it means rewriting history and force-pushing, and `main` is protected). Don't try to fix it silently.

**Local processes**: you may only stop what you started. Kill a test server by its PID or task id, never `pkill -f "next dev"` or another broad pattern, which also kills the user's own dev server. Check `lsof -i :<port>` first: if the process was there before your task, it is theirs.
