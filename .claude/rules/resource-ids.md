---
paths:
  - "supabase/migrations/**"
  - "lib/ids.ts"
  - "lib/data/**"
  - "app/api/**"
  - "app/**/page.tsx"
---

### Resource ID Tiers

**RULE**: A Tier 2 resource's id must never be exposed to users (page URLs, links in Slack, email, notifications or calendar feeds, copyable image/download links, exports and downloads such as CSV, and any API consumed by something other than our own client, e.g. a public or partner API or outbound webhook). Our own client-to-server API calls and request bodies are internal and fine, even for admins; ids there show up in browser dev tools but are not shared or copied. An admin page URL counts as exposed. If a feature needs to expose one, elevate the table to Tier 1 (readable prefix) first.

**Why**: Tier 1 tables get hand-chosen readable ids (`mbr_`, `prkl_`, `photo_`, ...) because people see them; Tier 2 (the rest) get short internal prefixes and can be migrated later without breaking any link. Exposing a Tier 2 id would make a later migration break links. Tier lists and the migration plan: `docs/decisions/SHORT_IDS_PLAN.md`. Tier 1 is converted and live (since 2026-10-23); Tier 2 and Bronze are still uuids until phase 2, but the rule applies now, since exposing a table's uuid today has the same cost later.

Not everything that looks like an id is one of ours. Slugs and feature or badge keys are chosen by people, external ids (Slack, Zoom, Kajabi, Stripe, Mux) by other systems, and secret tokens and browser-generated idempotency keys stay as they are; none of them is converted. A row's primary key is always produced by the server, never supplied by a person or a request body. See "Ids we don't generate" in `docs/decisions/SHORT_IDS_PLAN.md`.

### New Tables and Ids

**RULE**: A table we own gets a text primary key `id text PRIMARY KEY DEFAULT public.new_id('<prefix>')` (`<prefix>_<12 base58 chars>`, e.g. `mbr_7Kx2mQ9dFh3N`), never `uuid DEFAULT gen_random_uuid()`. A column that references one of our tables is `text`, not `uuid`. This keeps phase 2 of `docs/decisions/SHORT_IDS_PLAN.md` (converting the Tier 2 and Bronze tables) from growing with every new migration.

- **Prefix.** Lowercase letters only, unique across all tables, short and pronounceable (see the Tier 1 and Tier 2 lists in the plan; take the next free one for a new table). Record it in the table comment: `COMMENT ON TABLE ... IS '... [id prefix: xxx_]'`. A table a person will see in a URL, link or message is Tier 1 and needs a readable prefix agreed with the owner first; everything else is Tier 2 and its id must never be exposed (previous section).
- **References.** `member_id text NOT NULL REFERENCES members(id)`, not `uuid`. Tables whose key is a reference (`member_id` as the primary key) or a composite of references follow the same rule.
- **Still uuid.** Anything Supabase owns (`auth.users.id` and every column that references it: `user_id`, `created_by`, `updated_by`, ...), auth session ids, Vault secret ids, and ids the browser makes up (analytics `message_id`/`session_id`, watch-segment ids) stay `uuid`. External ids (Slack, Zoom, Kajabi, Stripe, Mux) are text from the source and are not ours.
- **App code.** Validate an id from a URL, query string or form with `isId(value, "<prefix>")` from `lib/ids.ts` (add the prefix to `ID_PREFIXES` for a new Tier 1 table), never with a uuid regex or `z.string().uuid()`. `isUuid` is only for auth and browser-made ids. Tests and fixtures use prefixed ids (`mbr_AAAAAAAAAAA1`; base58 has no `0`, `O`, `I` or `l`), not uuid literals.
- **SQL functions.** Arguments, results and variables that hold one of our ids are `text`. A function with a uuid argument that is really one of our ids breaks the moment the table converts: `CREATE OR REPLACE` cannot change a signature, so it means a drop and recreate with grants and comments replayed.
- **Migrations that rewrite ids.** If one sets `session_replication_role = replica` (to keep triggers and audit rows quiet), end it with `NOTIFY pgrst, 'reload schema';`: replica mode also silences the event trigger that makes PostgREST reload, and production would keep calling the old function signatures. See "Lessons from the phase 1 run" in the plan.
