-- pgTAP tests for new_id (20261122000000): format, prefix handling and uniqueness.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
-- Run with `npm run test:pgtap` (scripts/test-pgtap.sh; CI runs it in the test-db job).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(7);

SELECT matches(public.new_id('mbr'), '^mbr_[1-9A-HJ-NP-Za-km-z]{12}$',
  'id is the prefix, an underscore and 12 base58 characters');

SELECT is(
  (SELECT count(DISTINCT public.new_id('prkl')) FROM generate_series(1, 5000)),
  5000::bigint,
  '5000 ids are all different');

SELECT is(
  (SELECT count(*) FROM generate_series(1, 2000) WHERE public.new_id('x') !~ '^x_[1-9A-HJ-NP-Za-km-z]{12}$'),
  0::bigint,
  'every id matches the format');

SELECT is(
  (SELECT count(DISTINCT c) FROM (
     SELECT substr(public.new_id('x'), 3 + p, 1) AS c FROM generate_series(1, 4000), generate_series(0, 11) AS p
   ) t),
  58::bigint,
  'every base58 character shows up in positions 1 to 12');

SELECT throws_ok($$SELECT public.new_id('Mbr')$$, 'P0001', NULL, 'an uppercase prefix is rejected');
SELECT throws_ok($$SELECT public.new_id('mbr_')$$, 'P0001', NULL, 'a prefix with an underscore is rejected');
SELECT throws_ok($$SELECT public.new_id(NULL)$$, 'P0001', NULL, 'a null prefix is rejected');

SELECT * FROM finish(true);
ROLLBACK;
