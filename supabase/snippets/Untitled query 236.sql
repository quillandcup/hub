  SELECT name, normalized_name FROM prickle_types ORDER BY name;  SELECT column_name
  FROM information_schema.columns
  WHERE table_name = 'prickle_types';

SELECT * FROM bronze.kajabi_purchases WHERE kajabi_offer_id IN (
  SELECT kajabi_offer_id FROM bronze.kajabi_offers WHERE (data->'attributes'->>'subscription')::boolean IS TRUE
) AND deactivated_at IS NULL;