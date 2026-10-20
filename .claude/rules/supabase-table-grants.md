## supabase-table-grants

Supabase stopped automatically granting Data API access to new tables in the `public` schema on 2026-10-30 (existing tables keep their grants). A table created without explicit grants returns "permission denied" from supabase-js, PostgREST and GraphQL. This also hits migrations that recreate the schema: new projects, preview branches and local `supabase db reset`.

**Every migration that creates a table in `public` must grant access in the same migration**, alongside `enable row level security` and the policies:

```sql
grant select on public.your_table to anon;
grant select, insert, update, delete on public.your_table to authenticated;
grant select, insert, update, delete on public.your_table to service_role;
```

- Grant only what the table needs. RLS still filters rows, but a grant is the outer gate: omit `anon` for tables no signed-out visitor reads, omit write privileges the app never uses (e.g. server-written tables: `service_role` only), and use column-level `grant select (col)` where columns are hidden (see the Slack content tables in CLAUDE.md).
- Tables that are service role only get no `anon`/`authenticated` grants at all.
- Adding a column to a table with column-level grants needs its own `grant select (col)`.
- A new table's pgTAP/RLS test should fail without the grant, so cover it in `supabase/tests/database/`.
- Check which tables are exposed in the project's Data API settings.
