-- Screenshots for the member help articles (help/*.md), captured by the demo scenes (docs/DEMO_AND_HELP.md).
-- Private, and deliberately no storage.objects policies: members never read this bucket directly.
-- /help/images/<scene>/<file> checks the visitor is signed in, then streams the file with the service role.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('help-images', 'help-images', false, 5242880, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO NOTHING;
