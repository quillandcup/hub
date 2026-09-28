-- Store every commitment slot in the schedule's timezone (America/New_York; SCHEDULE_TIMEZONE in
-- lib/commitments.ts), not the member's own.
--
-- Prickles repeat at a fixed New York wall-clock time across DST. A slot stored in, say,
-- Europe/London sat an hour off the schedule in the weeks when US and UK daylight saving start or
-- end on different dates: kept/missed matching absorbed it (60-minute tolerance), but exact slot
-- checks and expected times were off. The app now builds and validates slots in the schedule's
-- timezone and only shows them in the member's timezone; this converts existing rows.
--
-- Each slot is converted at its commitment's first occurrence: that instant, re-read as New York
-- wall-clock time, gives the new weekday and time. When that lands on an earlier date (a member
-- east of New York, e.g. Tue 00:30 London = Mon 19:30 New York), the commitment's start_date moves
-- back to that date so the first week isn't dropped. Idempotent: rows already in New York time are
-- left alone.

CREATE TEMP TABLE commitment_slot_conversions ON COMMIT DROP AS
SELECT
  s.id AS slot_id,
  s.commitment_id,
  ((c.start_date + ((s.day_of_week - EXTRACT(DOW FROM c.start_date)::int + 7) % 7)) + s.start_time_local)
    AT TIME ZONE s.timezone AT TIME ZONE 'America/New_York' AS ny_local
FROM prickle_commitment_slots s
JOIN prickle_commitments c ON c.id = s.commitment_id
WHERE s.timezone <> 'America/New_York';

UPDATE prickle_commitments c
SET start_date = LEAST(c.start_date, earliest.ny_date), updated_at = now()
FROM (
  SELECT commitment_id, MIN(ny_local::date) AS ny_date
  FROM commitment_slot_conversions
  GROUP BY commitment_id
) earliest
WHERE c.id = earliest.commitment_id
  AND earliest.ny_date < c.start_date;

UPDATE prickle_commitment_slots s
SET day_of_week = EXTRACT(DOW FROM conv.ny_local)::smallint,
    start_time_local = conv.ny_local::time,
    timezone = 'America/New_York'
FROM commitment_slot_conversions conv
WHERE s.id = conv.slot_id;

COMMENT ON COLUMN prickle_commitment_slots.timezone IS
  'Always the schedule''s timezone (America/New_York, SCHEDULE_TIMEZONE in lib/commitments.ts): the
   slot is the prickle''s weekday + wall-clock time as the schedule repeats it. The app shows it in
   the member''s own timezone.';
