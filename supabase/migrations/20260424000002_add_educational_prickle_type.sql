-- Add Educational Prickle type
-- These are hosted educational sessions

INSERT INTO prickle_types (name, normalized_name, description, requires_host, default_host_id)
VALUES (
  'Educational Prickle',
  'educational',
  'Educational sessions and workshops',
  true,
  NULL
)
ON CONFLICT (normalized_name) DO NOTHING;
