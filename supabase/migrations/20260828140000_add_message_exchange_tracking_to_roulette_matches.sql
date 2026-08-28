-- Wheel of Wonder: "confirmed" used to mean "one human sent one reply" --
-- too weak a bar to celebrate as a real connection. Track a genuine
-- back-and-forth instead: both people's Slack user IDs (captured at room
-- creation, so the webhook can attribute a message without depending on
-- member_name_aliases resolving cleanly) and a running message count per
-- side. See app/api/webhooks/slack/route.ts's confirmRouletteMatch and
-- lib/roulette.ts's CONNECTION_CONFIRMATION_MESSAGE_THRESHOLD.

ALTER TABLE roulette_matches
    ADD COLUMN spinner_slack_user_id text,
    ADD COLUMN matched_slack_user_id text,
    ADD COLUMN spinner_message_count integer NOT NULL DEFAULT 0,
    ADD COLUMN matched_message_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN roulette_matches.spinner_message_count IS
  'Messages the spinner has sent in the shared room, excluding the bot''s own opening message.';
COMMENT ON COLUMN roulette_matches.matched_message_count IS
  'Messages the matched member has sent in the shared room, excluding the bot''s own opening message.';
