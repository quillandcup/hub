-- Hedgie Roulette match tracking: records the 3-person Slack room (spinner +
-- matched member + bot) created when someone spins, and whether either human
-- actually replied in it (a "confirmed connection"), detected via the Slack
-- Events webhook. Local layer (operational data owned by this app, plain
-- CRUD -- not reprocessed from Bronze/Silver).

CREATE TABLE roulette_matches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    spinner_member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    matched_member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    slack_channel_id text NOT NULL,
    status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'confirmed')),
    created_at timestamptz NOT NULL DEFAULT now(),
    confirmed_at timestamptz,
    confirmed_by_member_id uuid REFERENCES members(id) ON DELETE SET NULL
);

-- The webhook looks up the in-flight match by channel when a message arrives.
CREATE INDEX roulette_matches_slack_channel_id_idx ON roulette_matches (slack_channel_id);
CREATE INDEX roulette_matches_status_idx ON roulette_matches (status);

COMMENT ON TABLE roulette_matches IS
  'Hedgie Roulette matches: the Slack room created per spin, and whether a real human reply confirmed the connection (see app/api/webhooks/slack/route.ts).';

ALTER TABLE roulette_matches ENABLE ROW LEVEL SECURITY;

-- Authorization is enforced in the server action (spinRoulette in
-- app/(member)/roulette/actions.ts, scoped to the acting member's own
-- identity via getEffectiveIdentity) and in the webhook (service-role
-- client, bypasses RLS entirely) -- not in RLS -- consistent with how
-- prickle_host_vibes is protected (see
-- 20260827000002_create_prickle_host_vibes.sql).
CREATE POLICY "Authenticated users can view roulette_matches"
    ON roulette_matches FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert roulette_matches"
    ON roulette_matches FOR INSERT
    WITH CHECK (auth.role() = 'authenticated');
