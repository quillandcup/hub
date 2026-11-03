-- name_alias_key (20261223000000) removed every punctuation mark, so "Mary-Ann" became "maryann" while
-- "Mary Ann" stayed "mary ann" and the two were different aliases. Separators (hyphen, underscore, slash,
-- comma, ...) now count as a space, so both are "mary ann". Periods and apostrophes are still dropped, not
-- spaced, so "J.K. Rowling" stays "jk rowling" and "O'Brien" stays "obrien", as before.
--
-- Same signature, so CREATE OR REPLACE. The key is only computed on the fly (the conflict check), never
-- stored or indexed. Prod was checked first: no two members share a key under the new rule that did not
-- already share one under the old.
-- Keep in step with `aliasKey` in lib/member-matching.ts.

set lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.name_alias_key(p_name TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT coalesce(
    nullif(
      btrim(regexp_replace(regexp_replace(regexp_replace(lower(p_name), E'[''’.]', '', 'g'), '[^a-z0-9\s]', ' ', 'g'), '\s+', ' ', 'g')),
      ''
    ),
    lower(btrim(p_name))
  );
$$;
