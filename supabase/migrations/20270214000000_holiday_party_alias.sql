-- The Holiday Party has been on the calendar as "Quill & Cup Holiday Party (AM)!", "(PM)!" and
-- "QUILL & CUP HOLIDAY PARTY!", which normalize to quill-cup-holiday-party[-am|-pm], not to the type's own
-- name (qc-holiday-party). The alias makes all of them match.

UPDATE prickle_types
   SET summary_aliases = (SELECT array_agg(DISTINCT a ORDER BY a) FROM unnest(summary_aliases || ARRAY['quill-cup-holiday-party']) AS a)
 WHERE normalized_name = 'qc-holiday-party';
