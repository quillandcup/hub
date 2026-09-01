-- Narrows the Founding Hedgie cutoff from end-of-Q1-2022 to end-of-January-2022,
-- to match the updated computation in lib/badges.ts's isFoundingHedgie().
UPDATE badge_types
SET description = 'Joined during our founding era (2021 - January 2022).'
WHERE key = 'founding_hedgie';
