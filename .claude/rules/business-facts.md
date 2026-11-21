---
paths:
  - "src/lib/**"
  - "src/app/**"
---

### Business Facts: Derive, Don't Assume

**RULE**: Don't hardcode a business number or assume a naming pattern from what you happened to see. Read it from the source data, or derive it.

- Trial length is not a constant: it is usually 7 days but has been a month, many Stripe offers have no trial, and some programs (180 Program, Self Editing Academy) have none at all. Take it from the contact's or offer's own data, and handle "none".
- Whether a trial converted, who counts as a returning member, and similar outcomes are derived from membership history (see `src/lib/mentorship.ts`), never stored or guessed.
- Titles and labels come from the data. Don't parse "Week 1" or "Module 2" out of a title, or assume every module has one; they don't all start that way.
- If the data isn't there, say so and add a `docs/TODO.md` entry (`.claude/rules/defer-to-todo.md`) instead of picking a default.
