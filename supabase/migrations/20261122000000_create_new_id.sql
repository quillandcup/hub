-- new_id(prefix): short prefixed random ids such as mbr_7Kx2mQ9dFh3N, the column default that
-- replaces gen_random_uuid() as tables move off uuid ids (docs/SHORT_IDS_PLAN.md).
--
-- 12 base58 characters (about 70 bits). Entropy comes from gen_random_uuid(), which is built
-- in (no pgcrypto, no search_path to a schema that differs between local and hosted). Bytes 6
-- and 8 of a v4 uuid carry fixed version/variant bits, so they are skipped, and bytes >= 232
-- (4 * 58) are rejected so the modulo has no bias. The primary key backstops a collision.
CREATE OR REPLACE FUNCTION public.new_id(prefix text)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $$
DECLARE
  alphabet CONSTANT text := '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  result text := '';
  bytes bytea;
  b int;
BEGIN
  IF prefix IS NULL OR prefix !~ '^[a-z]+$' THEN
    RAISE EXCEPTION 'new_id: prefix must be lowercase letters, got %', prefix;
  END IF;

  WHILE length(result) < 12 LOOP
    bytes := uuid_send(gen_random_uuid());
    FOR i IN 0..15 LOOP
      CONTINUE WHEN i IN (6, 8);
      b := get_byte(bytes, i);
      CONTINUE WHEN b >= 232;
      result := result || substr(alphabet, (b % 58) + 1, 1);
      EXIT WHEN length(result) = 12;
    END LOOP;
  END LOOP;

  RETURN prefix || '_' || result;
END;
$$;

COMMENT ON FUNCTION public.new_id(text) IS
  'Random short id "<prefix>_<12 base58 chars>", the default for text primary keys. See docs/SHORT_IDS_PLAN.md.';
