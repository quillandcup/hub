-- A Kajabi offer linked to an event can have a purchase date window, so an offer that was reused
-- (a deposit sold for one retreat in 2024 and again for another in 2026) can serve two events:
-- a purchase counts for the event only when it was made on a day inside the window. Both ends are
-- inclusive days (Eastern time, worked out in the app) and either may be empty (open-ended).
--
-- Expand only. The old unique constraint on kajabi_offer_id stays for now, so the database still
-- refuses a second event for the same offer; dropping it is a separate, approved migration once
-- this has deployed. The new unique index is what will then keep one link per event and offer.
-- Staff edit a window, so admins get UPDATE.

set lock_timeout = '5s';

ALTER TABLE public.community_event_offers
  ADD COLUMN purchased_from date,
  ADD COLUMN purchased_until date,
  ADD CONSTRAINT community_event_offers_window_order CHECK (purchased_until IS NULL OR purchased_from IS NULL OR purchased_until >= purchased_from);

COMMENT ON COLUMN public.community_event_offers.purchased_from IS
  'First day (inclusive, Eastern) a purchase of the offer counts for the event; null = no start.';
COMMENT ON COLUMN public.community_event_offers.purchased_until IS
  'Last day (inclusive, Eastern) a purchase of the offer counts for the event; null = no end.';

CREATE UNIQUE INDEX community_event_offers_event_offer_key ON public.community_event_offers (event_id, kajabi_offer_id);

CREATE POLICY "Admins can update community_event_offers" ON public.community_event_offers
  FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
GRANT UPDATE ON public.community_event_offers TO authenticated;
