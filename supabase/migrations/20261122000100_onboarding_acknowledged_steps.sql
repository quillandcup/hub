-- Which tour steps a member had been through when they finished the Getting started tour, so a
-- step added later reopens the tour for just that step (lib/onboarding.ts, unseenStepIds).
-- NULL = no snapshot (never completed, or restarted): nothing reopens.

ALTER TABLE public.member_onboarding ADD COLUMN IF NOT EXISTS acknowledged_steps TEXT[];

-- Members who finished before this existed had seen every step except "slack".
UPDATE public.member_onboarding
SET acknowledged_steps = ARRAY['identity','identity.basics','identity.names','identity.emails','profile','intro','writing','prickles','calendar','big-sister','hosting','host-vibe']
WHERE completed_at IS NOT NULL AND dismissed_at IS NULL AND acknowledged_steps IS NULL;
