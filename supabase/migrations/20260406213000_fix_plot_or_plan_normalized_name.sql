-- Fix normalized_name for "Plot or Plan Prickle" to match normalization function output
-- The normalization function converts "Plot or Plan Prickle" → "plot-or-plan"
-- but the seed data had "plot-plan" (missing the "or")

UPDATE prickle_types
SET normalized_name = 'plot-or-plan'
WHERE name = 'Plot or Plan Prickle';

COMMENT ON TABLE prickle_types IS 'Fixed: Plot or Plan Prickle normalized_name to match function output (plot-or-plan)';
