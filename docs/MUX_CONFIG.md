# Mux configuration as code

`mux-config.yml` is the source of truth for the Mux settings its API can manage: the webhook that tells the Hub a course video is ready, and the playback restriction (which sites may play a signed video). `scripts/mux-config.ts` compares it with the live Mux environment (`diff`, read-only) and applies it (`push`). Unlike the Slack, Supabase and Vercel configs, **CI never pushes this one**: the webhook's signing secret is shown once and has to land in `.env.prod`, so the operator runs it.

The webhook address is `<APP_URL>/api/webhooks/mux` (`APP_URL` is `appUrl` in `app.config.ts`). The logic that builds the desired state and compares it is `lib/mux-config.ts` (unit-tested); the script only does the HTTP calls.

## What is and isn't managed

| Setting | Managed here | Notes |
| --- | --- | --- |
| Webhook (`/system/v1/webhooks`) | yes | Needs a token with the **System** permission. One webhook for the production address; other webhooks are listed and never touched. |
| Playback restriction (`/video/v1/playback-restrictions`) | yes | One restriction per environment: created if none, updated if it differs, refused if several exist (they have no name, so ours can't be told apart). |
| URL signing keys | no | The private half is shown once. Create by hand (Settings -> Signing Keys); the secret goes in `.env.prod` as `MUX_SIGNING_KEY_PRIVATE`. |
| Spending alerts | no, no API | Dashboard only (up to 3, email, paid plans). Manual checklist: alerts above $10, $25 and $75 (done 2026-10-28). |
| Access tokens | no | Created by hand; see "Tokens". |

**A playback restriction does nothing by itself.** Mux applies it only to a token that carries its id as the `playback_restriction_id` claim. Creating the restriction is harmless; enforcing it is a separate, switchable step (next section).

## Enforcing the restriction

`signPlaybackTokens` (`lib/mux.ts`) adds the claim to the **video** token (the stream) when both hold:

1. `MUX_PLAYBACK_RESTRICTION_ID` is set in that deployment (a non-secret env var, declared in `env-vars.config.ts`, synced to Vercel preview and production). The id is **per Mux environment**: production's, the "Hedgie Hub - Local Dev" environment's (used by preview and local) and the checks environment's all differ. Unset means nothing is enforced.
2. The `mux_playback_restriction` feature flag is on for the effective viewer (the sudo'd member in sudo). It is created off (`enabled_globally = false`) and is turned on from the feature flags admin UI: first as your own preview, then a segment, then everyone.

Otherwise the tokens are exactly what they were before. Thumbnail and storyboard tokens never carry the claim: Mux supports it on every token type, but the stream is what we protect, and images are what a wrong domain list would break most confusingly. Only the member lesson page passes the id; the admin lesson builder's player stays unrestricted. The nightly Checkly stream check uses a separate Mux environment with no restriction and tokens from `__checks__/mux-token.ts`, so it is unaffected and needs no change now. If you ever want it to prove enforcement, that environment needs its own restriction and the check's token needs the same claim.

**Rollout, in order**

1. Production: put `MUX_PLAYBACK_RESTRICTION_ID=<id>` in `.env.prod`, then `pnpm env:sync --only=MUX_PLAYBACK_RESTRICTION_ID --target=production`. Preview: the Local Dev environment's id in `.env.preview`, `pnpm env:sync --only=MUX_PLAYBACK_RESTRICTION_ID --target=preview` (see "The Local Dev environment" below).
2. Turn `mux_playback_restriction` on for yourself only (admin feature flags page, your own preview). Nobody else is affected.
3. In a real browser, on production and on a preview, open a lesson with video: desktop Chrome and Safari, and a phone including Safari on iOS (which sends no `Referer`, allowed by `allowNoReferrer`). Check the video plays, seeking works, and that a request from another site is refused (403).
4. Widen the flag. To back out at any time, turn the flag off (tokens revert at once) or unset the env var.

## Finding the restriction's id

It is configuration, not a secret. `pnpm mux:config:diff` prints it on the "playback restriction" line (and `push` prints it when it creates or updates one), together with the exact `MUX_PLAYBACK_RESTRICTION_ID=<id>` line to add when the loaded environment doesn't have it. Or ask Mux directly: `GET /video/v1/playback-restrictions` (Basic auth with the environment's `MUX_TOKEN_ID`/`MUX_TOKEN_SECRET`), the `id` of the one entry.

## The Local Dev environment

Preview deployments and local development use a different Mux environment with its own keys, so they need their own restriction. The `:dev` scripts manage the restriction too (they read `.env.local`, whose `MUX_TOKEN_ID`/`MUX_TOKEN_SECRET` are that environment's): `pnpm mux:config:diff:dev`, then `pnpm mux:config:push:dev` creates it (the webhook part needs `TUNNEL_DOMAIN` and a System token and is independent of this). The dev restriction uses the same domain list from `mux-config.yml`. Then set the printed id as `MUX_PLAYBACK_RESTRICTION_ID` in `.env.local` and `.env.preview`.

## Day to day

```bash
pnpm mux:config:diff    # read-only: what a push would change
pnpm mux:config:push    # apply it (production Mux environment, from .env.prod)
```

Before changing `mux-config.yml`, run the diff and check it shows only what you intend. Without `MUX_SYSTEM_TOKEN_ID` / `MUX_SYSTEM_TOKEN_SECRET` the webhook part says "not checked" and only the restriction is compared (with the app token, `MUX_TOKEN_ID`).

## Tokens

The app's token (`MUX_TOKEN_ID` / `MUX_TOKEN_SECRET`) has only Mux Video and Mux Data, and is in Vercel. Managing webhooks needs a separate token with the **System** permission: Mux -> Settings -> API Access Tokens -> New, permission System, in the production environment. Keep it on the operator's machine in `.env.prod` as `MUX_SYSTEM_TOKEN_ID` / `MUX_SYSTEM_TOKEN_SECRET`. It is deliberately **not** in `env-vars.config.ts`, so `env:sync` never sends it to Vercel or GitHub. Revoke it when you are done if you prefer; the diff works without it.

## Creating the production webhook, and its secret

The production webhook already exists (created by hand). `push` leaves it alone when its address matches. When it creates one (a new Mux environment, or after deleting the old one):

1. Mux shows the signing secret **once**. The script **never prints it**: it writes it straight to `MUX_WEBHOOK_SECRET` in `.env.prod` (`.env.local` with `--dev`).
2. If that file already has a `MUX_WEBHOOK_SECRET`, the script refuses to create the webhook (the new secret would silently replace the old one). Re-run with `--replace-secret` if that is what you mean.
3. Then `pnpm env:sync --only=MUX_WEBHOOK_SECRET` so Vercel gets it. Until it does, the route answers 401 to everything (and Mux redelivers).

Rotating means deleting the webhook in the dashboard and running `push` again.

**When `diff` says "create" but a webhook already exists.** The check compares addresses leniently (host case, a trailing slash and a default port do not count as different), and lists each webhook it does not manage by address (scheme, host and path only: credentials and any query are never shown). If it still says "create" and lists exactly one other webhook that is this app's, at an old or different address, **do not push**: that would create a second webhook and every event would be delivered twice. Run `pnpm mux:config:diff --adopt` to see it move to the configured address, then `pnpm mux:config:push --adopt`. Moving a webhook keeps its signing secret, so `MUX_WEBHOOK_SECRET` stays valid and nothing needs syncing.

**When the only other webhook is a developer tunnel** (an `ngrok`, `loca.lt` or `trycloudflare.com` address, or localhost), it is someone's local setup, not production's. The script says so, refuses `--adopt` for it, and you should not push. The usual cause: a Mux account has several environments (for example Production and Development), a token belongs to one of them, and the System token was created in a different environment from `MUX_TOKEN_ID`. In the dashboard, switch environments until Settings, Access Tokens shows the token whose id is in `MUX_TOKEN_ID`, and create the System token there; its Settings, Webhooks page should list the production address.

**Which token does what.** Webhooks use the System token (`MUX_SYSTEM_TOKEN_ID` / `_SECRET`). The playback restriction is part of Mux Video, so it uses the app token (`MUX_TOKEN_ID` / `_SECRET`): the System token is refused there.

## A developer's own webhook (`--dev`)

Real "video ready" notifications locally need a public address (`docs/WEBHOOK_SETUP.md`: `TUNNEL_DOMAIN` in `.env.local`, then `pnpm tunnel`) and a webhook in **your own** Mux environment, with that environment's token (`MUX_SYSTEM_TOKEN_ID/SECRET` in `.env.local`).

```bash
pnpm mux:config:diff:dev
pnpm mux:config:push:dev   # creates https://$TUNNEL_DOMAIN/api/webhooks/mux
```

It saves the secret to `MUX_WEBHOOK_SECRET` in `.env.local` (restart `pnpm dev`). Re-running is a no-op when the webhook exists; if `TUNNEL_DOMAIN` changed and your environment has exactly one webhook, its address is updated and its secret kept. Without all this, local development polls Mux for status, which is fine for most work.

## The nightly end-to-end check

`__checks__/mux-e2e.check.ts` (Checkly, once a day, deployed by `.github/workflows/checkly.yml`):

- **Webhook rejects unsigned** (always on): `POST /api/webhooks/mux` with an empty body must answer 401. Proves the route is deployed, reachable and refusing unsigned calls. It sends nothing a member could own.
- **Signed playback returns a manifest** and **a signed asset without a token is refused (403)**: need a tiny test asset. They mint a token with `__checks__/mux-token.ts` (same claims as `signPlaybackTokens`) and fetch the HLS manifest.

The stream checks use a standing test asset in a **separate Mux environment** ("checks"), with that environment's own signing key, so Checkly never holds production's keys and the check costs about a cent a month. They are not declared until all three values are set:

1. Mux dashboard -> environment switcher -> create an environment named for the checks.
2. Settings -> Signing Keys -> create a key there. Put its id and private key in `.env.prod` as `MUX_CHECK_SIGNING_KEY_ID` and `MUX_CHECK_SIGNING_KEY_PRIVATE`.
3. Upload any few-second clip (Basic quality, **signed** playback policy). Put its signed playback id in `.env.prod` as `MUX_CHECK_PLAYBACK_ID`.
4. `pnpm env:sync:github --only=MUX_CHECK_SIGNING_KEY_ID,MUX_CHECK_SIGNING_KEY_PRIVATE,MUX_CHECK_PLAYBACK_ID`, then run the Checkly workflow (`gh workflow run checkly.yml --ref main`) to deploy the check.

Not covered: that Mux can *deliver* a webhook to us and that a real course video plays through the player. A webhook delivery test would need a throwaway asset created in the production environment on every run; see `docs/TODO.md`.
