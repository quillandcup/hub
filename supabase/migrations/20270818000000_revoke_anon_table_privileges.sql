-- Defence in depth: the signed-out role (`anon`) holds no table privileges in `public` or `bronze`.
--
-- Older migrations, and Supabase's default privileges, handed `anon` full table privileges and
-- `SELECT` on the raw-import tables. Row level security already refuses every signed-out request, but
-- a grant that is never used is one policy mistake away from being a hole. Nothing in the app reads or
-- writes these tables as `anon`: signed-out pages and routes use the service role, and signed-in
-- requests run as `authenticated`. Privilege-only change: no rows are rewritten, and `authenticated`
-- and `service_role` keep their grants. Functions (such as `is_admin`) are untouched.

set lock_timeout = '5s';

revoke all on all tables in schema public from anon;
revoke all on all tables in schema bronze from anon;
revoke all on all sequences in schema public from anon;
revoke all on all sequences in schema bronze from anon;

-- New tables and sequences created by the migration role start without anon access.
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema bronze revoke all on tables from anon;
alter default privileges for role postgres in schema bronze revoke all on sequences from anon;
