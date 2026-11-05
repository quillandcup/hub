set lock_timeout = '5s';

-- One log of what the app sent on its own initiative, for every kind, instead of a table per kind:
-- a row is the claim "this recipient was sent this kind of thing for this dedup key", taken before the send,
-- so two overlapping runs or a retry never send it twice. The first user is the changelog digest
-- (kind changelog_digest, key = the entry's slug, so a member gets each entry once and a missed week catches up).
-- member_reminder_log and prickle_checkin_dm_log stay as they are until they move onto this (docs/TODO.md).
--
-- A recipient is a member (member_id) or a shared place such as a Slack channel (place, "slack:<channel id>").
-- Service role only: nothing a member or admin reads.

CREATE TABLE public.notification_log (
  id         text PRIMARY KEY DEFAULT public.new_id('nlog'),
  kind       text NOT NULL,
  -- Who it went to: a member, or a shared place. Exactly one of the two.
  member_id  text REFERENCES public.members(id) ON DELETE CASCADE,
  place      text,
  -- What was sent, in the kind's own terms (an entry slug, a prickle id, a day).
  dedup_key  text NOT NULL,
  sent_at    timestamptz NOT NULL DEFAULT now(),
  -- The one value the unique constraint uses, so a plain INSERT can tell a repeat (23505).
  recipient  text GENERATED ALWAYS AS (coalesce(member_id, place)) STORED,
  CONSTRAINT notification_log_one_recipient CHECK (num_nonnulls(member_id, place) = 1),
  CONSTRAINT notification_log_claim_key UNIQUE (recipient, kind, dedup_key)
);

CREATE INDEX notification_log_kind_idx ON public.notification_log (kind, member_id);

COMMENT ON TABLE public.notification_log IS
  'LOCAL: what the app sent a member or a shared place on its own initiative, one row per (recipient, kind, dedup key), claimed before sending. Service role only. [id prefix: nlog_]';

ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_log FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_log TO service_role;

-- Erasing a member removes what we recorded sending them (the member_data_handling test requires a decision per member foreign key).
INSERT INTO public.member_data_handling (table_name, column_name, action, why) VALUES
  ('notification_log', 'member_id', 'delete', 'notifications sent to them');

-- The weekly digest starts in dry run: the flag says who gets it for real (an admin's own preview first, then a
-- segment, then everyone); for everyone else the job only logs what it would have sent.
INSERT INTO feature_flags (feature_key, enabled_globally)
VALUES ('changelog_digest', false)
ON CONFLICT (feature_key) DO NOTHING;
