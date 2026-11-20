# Contributing

Hedgie Hub is the member platform for Quill & Cup. The source is public so people can read it, but it is released under a proprietary, all-rights-reserved license (`LICENSE`).

## What we accept

- **Bug reports and questions**: open an issue. Say what you did, what you expected and what happened. Leave out personal data (names, emails, ids, tokens).
- **Security problems**: never in an issue. Follow `SECURITY.md`.
- **Code, docs and other changes**: not accepted from outside the organization for now. There is no contributor agreement, so we can't take ownership of, or a license to, outside code. If that changes, this file will say how.

Issues are read by the maintainers and answered as time allows, usually within a few weeks. English is the working language.

## For people on the team

Everything about how we work is in the repository:

- Setup and commands: `README.md` and `CLAUDE.md` (`pnpm dev`, `pnpm test:unit`, `pnpm typecheck`, `pnpm lint`).
- The rules every change follows: `.claude/rules/` (data access, tests, migrations, notifications, public-repo hygiene and more).
- **Every behavior change ships with tests** (`.claude/rules/tests-with-every-change.md`). CI requires 80% of added lines to be covered, and the coverage report is a required check.
- Changes land through a pull request from a branch; nothing goes to `main` directly. CI must pass, and every review thread must be resolved.
- Style is enforced by ESLint and TypeScript (`pnpm lint`, `pnpm typecheck`), not by convention alone.
- The repository is public: no real member data, secrets or non-public ids anywhere (`.claude/rules/public-repo-hygiene.md`).

How decisions are made: `GOVERNANCE.md`.
