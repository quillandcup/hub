-- An offer could be linked to one event only (`kajabi_offer_id UNIQUE`). Since #1254 a link has an
-- optional purchase window and the app lets the same offer serve two events when their windows do not
-- overlap (a deposit offer reused for a later retreat), checking the overlap itself. The
-- (event_id, kajabi_offer_id) unique index keeps one link per event and offer.

set lock_timeout = '5s';

-- Approved ban-drop-constraint ignore: the last use of the one-event-per-offer rule was removed in #1254, which is deployed.
-- squawk-ignore ban-drop-constraint
ALTER TABLE public.community_event_offers DROP CONSTRAINT community_event_offers_kajabi_offer_id_key;
