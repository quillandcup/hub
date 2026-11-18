-- pgTAP test for 20270818000000_revoke_anon_table_privileges.sql: the signed-out role holds no privilege on any
-- table in public or bronze, and a table created by the migration role starts without any for it. Rolled back;
-- `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(5);

SELECT is(
  (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'bronze') AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('anon', c.oid, 'INSERT')
        OR has_table_privilege('anon', c.oid, 'UPDATE') OR has_table_privilege('anon', c.oid, 'DELETE')
        OR has_table_privilege('anon', c.oid, 'TRUNCATE') OR has_table_privilege('anon', c.oid, 'REFERENCES')
        OR has_table_privilege('anon', c.oid, 'TRIGGER'))),
  0, 'anon holds no privilege on any table or view in public or bronze');

SELECT is(
  (SELECT count(*)::int FROM information_schema.role_table_grants
    WHERE grantee = 'anon' AND table_schema IN ('public', 'bronze')),
  0, 'the grants view lists nothing for anon in public or bronze');

SELECT ok(
  has_table_privilege('authenticated', 'public.user_profiles', 'SELECT')
    AND has_table_privilege('service_role', 'public.user_profiles', 'SELECT'),
  'signed-in users and the service role keep their grants');

SET LOCAL ROLE postgres;
CREATE TABLE public.pgtap_anon_default_probe (id text);
CREATE TABLE bronze.pgtap_anon_default_probe (id text);
RESET ROLE;

SELECT ok(
  NOT has_table_privilege('anon', 'public.pgtap_anon_default_probe', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.pgtap_anon_default_probe', 'INSERT')
    AND NOT has_table_privilege('anon', 'public.pgtap_anon_default_probe', 'UPDATE')
    AND NOT has_table_privilege('anon', 'public.pgtap_anon_default_probe', 'DELETE')
    AND NOT has_table_privilege('anon', 'public.pgtap_anon_default_probe', 'TRUNCATE'),
  'a new table in public gives anon nothing by default');
SELECT ok(
  NOT has_table_privilege('anon', 'bronze.pgtap_anon_default_probe', 'SELECT')
    AND NOT has_table_privilege('anon', 'bronze.pgtap_anon_default_probe', 'INSERT'),
  'a new table in bronze gives anon nothing by default');

SELECT * FROM finish(true);
ROLLBACK;
