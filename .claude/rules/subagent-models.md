## subagent-models

Subagents inherit the session's model unless the Agent call sets `model`. Set it on purpose, since subagents were 45% of usage.

- `haiku`: searches, file lookups, read-only reviews and reading (Explore-style work, `member-reader-review`).
- `sonnet`: anything that edits files, runs tests or does multi-step work where a miss costs a retry.
- `opus`: only when the user asks.

When unsure, use `sonnet`. Never leave it unset in an Opus session.
