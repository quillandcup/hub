# Outbound requests

Every request the app makes to a server that is not ours says who we are in its `User-Agent`:

```
HedgieHub/<short commit sha> (+https://<app url>; <support email>)
```

Defined once, in `lib/config.ts` (`OUTBOUND_USER_AGENT`), from `app.config.ts` (`userAgentProduct`, `appUrl`, `supportEmail`) and the deployed commit (`dev` when there is none). It follows RFC 9110: `product/version (comment)`, ASCII only, no control characters; the product is a token (so not "Quill & Cup Hub"), the human text sits in the comment. It carries nothing about a member.

Why: some hosts refuse a request with no User-Agent (Wikimedia answers 403) or ask for a name and a contact so they can reach us instead of blocking us. Node's default (`node`/`undici`) says neither.

## What is covered

| Client | How |
| --- | --- |
| Raw `fetch` to an external host (Resend, Kajabi, Zoom, Google Photos, TrackBear, Mux stills, course media, Checkly heartbeats, scripts) | `outboundFetch` / `outboundHeaders` (`lib/http/outbound.ts`) |
| Picture and cover downloads (`lib/net/safe-fetch.ts`) | `DEFAULT_USER_AGENT` is the same constant; the `userAgent` option still overrides |
| Slack (`@slack/web-api`) | `createSlackClient` (`lib/slack-client.ts`) calls `addAppMetadata`, which puts `HedgieHub/<sha>` in front of the SDK's own clause |
| Stripe | `appInfo` (Stripe adds it to its own clause) |
| Google Calendar (`googleapis`) | `userAgentDirectives`, next to `google-api-nodejs-client` |
| Mux (`@mux/ts`) | `defaultHeaders["User-Agent"]`: ours, then the SDK's `Mux/JS <version>` (the option replaces the SDK's value, so its clause is re-added) |
| Web Push (`web-push`) | `headers` option on both send paths |

Not ours to change, so exempt: calls to our own Supabase project and our own routes (`pg_net` cron calls too), browser-side `fetch` (the browser sets it), Checkly's own checks, Sentry's SDK transport, and the token request Google's auth library makes for the service account.

## Adding an integration

- A raw `fetch` to someone else's host: `outboundFetch(url, init)`; pass an integration token to say which feature (`outboundFetch(url, init, "slack-import/1")`).
- An SDK: look for its supported way to add to the User-Agent (an app-info option, a directive list, `addAppMetadata`) and wire it where the client is built, once. Never replace the SDK's own clause.
- `tests/lib/outbound-user-agent.test.ts` fails on a new external `fetch(` without the wrapper, on `new WebClient(` outside `createSlackClient`, and on the SDK call sites above without their option. Its allowlist only shrinks, each entry with a reason.
