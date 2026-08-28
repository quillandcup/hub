-- "Hedgie Roulette" was renamed to "Wheel of Wonder" at the user-facing
-- level (see 20260828130000_rename_hedgie_roulette_feature_key.sql). This
-- migration finishes the rename for the last piece deliberately left alone
-- at the time: the table itself. Column names already don't mention
-- "roulette" and are untouched.

ALTER TABLE roulette_matches RENAME TO wheel_of_wonder_matches;

ALTER INDEX roulette_matches_slack_channel_id_idx RENAME TO wheel_of_wonder_matches_slack_channel_id_idx;
ALTER INDEX roulette_matches_status_idx RENAME TO wheel_of_wonder_matches_status_idx;

-- Policy names carried the old table name too -- rename them so `SELECT *
-- FROM pg_policies` doesn't keep showing "roulette_matches" long after the
-- table itself no longer does.
ALTER POLICY "Authenticated users can view roulette_matches" ON wheel_of_wonder_matches
    RENAME TO "Authenticated users can view wheel_of_wonder_matches";
ALTER POLICY "Authenticated users can insert roulette_matches" ON wheel_of_wonder_matches
    RENAME TO "Authenticated users can insert wheel_of_wonder_matches";

COMMENT ON TABLE wheel_of_wonder_matches IS
  'Wheel of Wonder matches: the Slack room created per spin, and whether a real human reply confirmed the connection (see app/api/webhooks/slack/route.ts).';
