-- In-app feedback widget: lets members/admins flag bugs, incorrect/missing
-- data, or ideas from any page, with an optional screenshot attached.
-- Local layer (operational data, plain CRUD — not reprocessed from Bronze).

CREATE TABLE feedback (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    -- user_id is always the REAL authenticated user (sudo does not change the
    -- auth session), so there's always a way to go ask the actual person a
    -- question even when they submitted while sudo'd into a member's view.
    user_id uuid NOT NULL REFERENCES auth.users(id),
    -- member_id is the EFFECTIVE identity (lib/sudo.ts getEffectiveIdentity):
    -- the sudo'd member when is_sudo is true, otherwise the submitter's own
    -- member record. Null for admin-only users with no member record.
    member_id uuid REFERENCES members(id),
    is_sudo boolean NOT NULL DEFAULT false,
    page_url text NOT NULL,
    feedback_type text NOT NULL CHECK (feedback_type IN ('bug', 'data', 'idea')),
    message text NOT NULL,
    screenshot_path text,
    user_agent text,
    status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'acknowledged', 'resolved', 'wontfix')),
    admin_notes text
);

CREATE INDEX feedback_created_at_idx ON feedback (created_at DESC);
CREATE INDEX feedback_status_idx ON feedback (status);

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- Submitters can only insert rows attributed to themselves.
CREATE POLICY "Users can submit their own feedback"
    ON feedback FOR INSERT
    WITH CHECK (user_id = auth.uid());

-- Submitters can see their own feedback (status/admin_notes) once a "my
-- feedback" view is built; admins can see everything. Reuses the existing
-- is_admin() helper (supabase/migrations/20260515000002_fix_user_profiles_rls_recursion.sql)
-- to avoid the RLS-recursion issue that function was created to fix.
CREATE POLICY "Users can view their own feedback, admins view all"
    ON feedback FOR SELECT
    USING (user_id = auth.uid() OR is_admin());

-- Only admins triage/resolve feedback.
CREATE POLICY "Admins can update feedback"
    ON feedback FOR UPDATE
    USING (is_admin());

-- Private bucket for feedback screenshots. Objects are stored under
-- {user_id}/{feedback_id}.png so the per-user-folder RLS pattern below works.
INSERT INTO storage.buckets (id, name, public)
VALUES ('feedback-screenshots', 'feedback-screenshots', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users can upload their own feedback screenshots"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'feedback-screenshots'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

CREATE POLICY "Users can view their own feedback screenshots, admins view all"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'feedback-screenshots'
        AND ((storage.foldername(name))[1] = auth.uid()::text OR is_admin())
    );
