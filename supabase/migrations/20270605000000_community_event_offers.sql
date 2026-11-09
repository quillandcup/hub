-- Which Kajabi offers sell tickets to an event. Staff link them on the event page, and "Find
-- Kajabi matches" lists the buyers who are not attendees yet (and, later, adds them automatically).
-- The offer is named by Kajabi's own id, not its title, which can be edited. One offer sells one
-- event, so an offer can be linked once; an event can have several offers (deposit, payment plan,
-- full price).
--
-- No foreign key to bronze.kajabi_offers: Bronze is re-imported and its rows are not ours.
-- Admin only (staff configuration; members have no use for it).

set lock_timeout = '5s';

CREATE TABLE public.community_event_offers (
  id text PRIMARY KEY DEFAULT public.new_id('evo'),
  event_id text NOT NULL REFERENCES public.community_events(id) ON DELETE CASCADE,
  kajabi_offer_id text NOT NULL UNIQUE,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_community_event_offers_event_id ON public.community_event_offers (event_id);

COMMENT ON TABLE public.community_event_offers IS
  'Local: a Kajabi offer (bronze.kajabi_offers.kajabi_offer_id) that sells tickets to an event. Admin only. [id prefix: evo_]';

ALTER TABLE public.community_event_offers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view community_event_offers" ON public.community_event_offers
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY "Admins can insert community_event_offers" ON public.community_event_offers
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Admins can delete community_event_offers" ON public.community_event_offers
  FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

REVOKE ALL ON public.community_event_offers FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON public.community_event_offers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.community_event_offers TO service_role;
