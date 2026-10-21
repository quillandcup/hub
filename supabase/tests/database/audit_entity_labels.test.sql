-- pgTAP tests for audit_entity_label (20261029000100): audit rows for records with no title of their
-- own are named after what they point at, and rows with a title keep it. Rolled back.
-- Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(5);

INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('00000000-0000-4000-a000-00000000f301', 'Label Alice', 'label-alice@example.test', now(), 'lead');
INSERT INTO public.segments (id, name) VALUES ('00000000-0000-4000-a000-00000000f311', 'Label Segment');
INSERT INTO public.segment_members (segment_id, member_id) VALUES
  ('00000000-0000-4000-a000-00000000f311', '00000000-0000-4000-a000-00000000f301');
INSERT INTO public.feature_flags (feature_key) VALUES ('label_test_flag');

SELECT is(
  (SELECT entity_label FROM public.audit_log WHERE entity_type = 'segment_member' AND entity_id LIKE '00000000-0000-4000-a000-00000000f311:%'),
  'Label Segment',
  'a segment membership is labelled with the segment''s name'
);
SELECT is(
  (SELECT entity_label FROM public.audit_log WHERE entity_type = 'feature_flag' AND entity_id = 'label_test_flag'),
  'label_test_flag',
  'a feature flag is labelled with its key'
);
SELECT is(
  (SELECT entity_label FROM public.audit_log WHERE entity_type = 'segment' AND entity_id = '00000000-0000-4000-a000-00000000f311'),
  'Label Segment',
  'a record with a name keeps it'
);

-- Backfill rule: a delete's delta carries the record, so the label can be rebuilt from it.
SELECT is(
  public.audit_entity_label('segment_member', '{"segment_id": "00000000-0000-4000-a000-00000000f311"}'::jsonb),
  'Label Segment',
  'the helper resolves from a bare row'
);
SELECT is(
  public.audit_entity_label('segment_member', '{"segment_id": "00000000-0000-4000-a000-00000000f399"}'::jsonb),
  NULL,
  'a dangling reference gives no label rather than an error'
);

SELECT * FROM finish(true);
ROLLBACK;
