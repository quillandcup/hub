## github-cli

**Always use the `gh` CLI for GitHub operations, never WebFetch or scraping.** `gh` uses the authenticated session and works on this repo's private data (PRs, checks, review threads, runs); WebFetch is unauthenticated and 404s on private repositories. Use `--json <fields>` for structured output (for example `gh pr view <number> --json state,mergeStateStatus`). Manual: https://cli.github.com/manual/

If a command fails with an auth error, check `gh auth status` and tell the user; don't work around it.
