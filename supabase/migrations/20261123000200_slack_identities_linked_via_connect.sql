-- Connecting Slack in Settings proves both sides (signed in to the Hub, and Slack's OAuth shows they
-- control that Slack account), so it can bind the Slack user to the Hub account: linked_via 'slack_connect'.
ALTER TABLE public.slack_identities DROP CONSTRAINT IF EXISTS slack_identities_linked_via_check;
ALTER TABLE public.slack_identities
  ADD CONSTRAINT slack_identities_linked_via_check
  CHECK (linked_via IN ('email_match', 'email_alias', 'account_link', 'admin', 'slack_connect'));
