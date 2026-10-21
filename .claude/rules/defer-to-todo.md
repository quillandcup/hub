## defer-to-todo

When you decide not to do something now, write it in `docs/TODO.md` in the same PR. A follow-up that lives only in chat, a PR description or a code comment is gone by the next session, and a requested "add a TODO" has had to be repeated many times.

**When it applies**
- You find a bug, gap or cleanup that is outside the change, or that the user said can wait.
- You choose a simpler version now and know what the fuller one needs ("room matching needs the secondary Zoom links", "convert these pickers to `EntitySearch`").
- The user says "add a TODO", "capture that", "note it for later".
- A source of data, a notification channel or a path isn't covered yet (for example, a webhook handled without its pull-based import: that is a rule violation to fix, but if it must wait, it goes here).

**How**
- Put it under the `##` section in `docs/TODO.md` that fits (Infrastructure & Deployment, Notifications, UI Enhancements, ...) as a `### Title` entry, with `_(Needs Scheduling)_` or another status tag if it has one. Match the entries around it.
- Say three things: what is missing or wrong, why it was deferred (what would make it worth doing), and where to start (files, tables, the related PR or doc). Someone with no context should be able to pick it up.
- When part of an entry is done, mark it the way the file does (**Resolved:** and **Still open:**) instead of deleting the history; remove an entry only when nothing is left.
- A `// TODO` in code is fine only when it points at the entry (`// TODO(docs/TODO.md: "Entry title")`). Don't leave a bare one.
- Mention what you deferred, in one line, in the PR description.

**Not here**: private data. The repo is public (`public-repo-hygiene.md`), so describe people and incidents without names, emails or ids.
