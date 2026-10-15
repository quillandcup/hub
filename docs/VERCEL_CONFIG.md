# Vercel project config as code

`vercel-project-config.yml` is the source of truth for the Vercel project settings that `vercel.json` can't express. Today that is **always-on tracing sampling rules** ([Vercel docs](https://vercel.com/docs/tracing/always-on-tracing)): production only, with a 0% rule on `/api/health` so Checkly's uptime pings aren't traced.

On a push to main that changes the file or `scripts/vercel-config.ts`, after the production deploy, CI's `push-vercel-config` job runs `scripts/vercel-config.ts push`. It prints the difference from the live project, applies it, then reads the rules back to confirm. A manual run (`gh workflow run ci.yml --ref main`) always applies it.

**A push replaces the whole rule list.** Rules added in the dashboard but missing from the file are removed. Change the file, not the dashboard.

## Before merging a change

```bash
VERCEL_TOKEN=... VERCEL_ORG_ID=team_... VERCEL_PROJECT_ID=prj_... npx tsx scripts/vercel-config.ts diff
```

Read-only (`npm run vercel:config:diff` does the same, but needs those three in `.env.prod`/`.env.shared`; `VERCEL_TOKEN` must be a team-scoped token). A `-` line is something live that the file doesn't have: a push would remove it.

## Notes

- Rules are ordered and the **first match wins**, so list specific paths above the catch-all. A request matching no rule isn't traced (that's why there's no Preview rule). Maximum 10 rules; an empty list turns tracing off.
- Add new health-check style endpoints as `rate: 0` rules above the catch-all.
- `rate` is a whole percent, 0-100. The `vercel traces config` CLI refuses 0; this script's endpoint (`/v1/drains/tracing/config`, the one the CLI uses) accepts it. That endpoint isn't in Vercel's public REST reference, so if a push starts failing, check whether it moved.
- Not covered: `@vercel/otel` framework spans (conflicts with Sentry's OpenTelemetry setup) and other project settings. New sections go in the same file and script.
