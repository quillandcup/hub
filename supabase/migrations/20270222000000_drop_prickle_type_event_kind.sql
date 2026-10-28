-- prickle_types.event_kind (20270219000000) was more setting than needed: a prickle's event is a session,
-- except the educational type, which is educational. Drop it; events keep their own event_type.
ALTER TABLE prickle_types DROP CONSTRAINT IF EXISTS prickle_types_event_kind_check;
ALTER TABLE prickle_types DROP COLUMN IF EXISTS event_kind;
