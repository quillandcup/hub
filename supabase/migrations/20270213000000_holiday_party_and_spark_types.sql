-- Two session types the community lead named, not in the app yet: listed in Events and announced publicly,
-- members only. Their normalized names are what the calendar titles normalize to ("Q&C HOLIDAY PARTY",
-- "Get Your Spark Back Prickle w/..."), so the calendar sync matches them without an alias.

INSERT INTO prickle_types (name, normalized_name, requires_host, purpose, listed_in_events, announced_publicly, guests_allowed)
VALUES
  ('Q&C Holiday Party', 'qc-holiday-party', false, 'social', true, true, false),
  ('Get Your Spark Back Prickle', 'get-your-spark-back', true, 'writing', true, true, false)
ON CONFLICT (normalized_name) DO UPDATE
  SET listed_in_events = true, announced_publicly = true, guests_allowed = false;
