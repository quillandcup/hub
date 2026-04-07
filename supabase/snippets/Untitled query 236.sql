  SELECT name, normalized_name FROM prickle_types ORDER BY name;  SELECT column_name
  FROM information_schema.columns
  WHERE table_name = 'prickle_types';