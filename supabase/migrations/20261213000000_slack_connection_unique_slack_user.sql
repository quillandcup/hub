-- One Slack account belongs to one member's connection. Connecting Slack is the strongest proof the
-- Hub has of who a Slack user is (the member signed in to the Hub and to that Slack account), and
-- the matcher (lib/slack-matching.ts) lets it outrank every guess, so two members must never both
-- hold the same Slack user id. lib/slack-connect.ts (linkSlackAccount) refuses the second one with a
-- clear message; this is the backstop for two connects racing.
CREATE UNIQUE INDEX IF NOT EXISTS member_slack_connections_slack_user_id_key
  ON public.member_slack_connections (slack_user_id);
