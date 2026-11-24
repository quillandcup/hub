-- Buyers of an event's ticket who will not attend it (a forfeited deposit, a ticket moved to
-- another event), with the reason. "Find Kajabi matches" leaves a marked buyer out of the list
-- that "Add as attendees" fills. One row per (event, member). Staff only.
-- Expand only: a new table; nothing existing changes.

set lock_timeout = '5s';

CREATE TABLE public.event_buyers_not_attending (
  id text PRIMARY KEY DEFAULT public.new_id('evna'),
  event_id text NOT NULL REFERENCES public.community_events(id) ON DELETE CASCADE,
  member_id text NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('forfeited', 'other')),
  note text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_buyers_not_attending_unique UNIQUE (event_id, member_id),
  CONSTRAINT event_buyers_not_attending_other_needs_note CHECK (reason <> 'other' OR (note IS NOT NULL AND btrim(note) <> ''))
);
CREATE INDEX idx_event_buyers_not_attending_member_id ON public.event_buyers_not_attending (member_id);

COMMENT ON TABLE public.event_buyers_not_attending IS
  'Local: a member who bought a ticket to an event but is not attending it. reason forfeited = signed up, could not come, deposit not refunded; other = a rare case (such as a ticket moved to another event) and the note says what. Admin only. [id prefix: evna_]';

ALTER TABLE public.event_buyers_not_attending ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view event_buyers_not_attending" ON public.event_buyers_not_attending
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY "Admins can insert event_buyers_not_attending" ON public.event_buyers_not_attending
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Admins can update event_buyers_not_attending" ON public.event_buyers_not_attending
  FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Admins can delete event_buyers_not_attending" ON public.event_buyers_not_attending
  FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

REVOKE ALL ON public.event_buyers_not_attending FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_buyers_not_attending TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_buyers_not_attending TO service_role;

CREATE TRIGGER audit_row_change AFTER INSERT OR UPDATE OR DELETE ON public.event_buyers_not_attending
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('event_buyer_not_attending', 'id');

INSERT INTO public.member_data_handling (table_name, column_name, action, why)
VALUES ('event_buyers_not_attending', 'member_id', 'repoint', 'why a ticket buyer is not attending an event: a merge moves it to the kept member');
