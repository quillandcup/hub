-- A Zoom name an admin ignored for one prickle only ("not this time"), as opposed to
-- ignored_zoom_names, which hides the name everywhere, for every future appearance.
-- Prickle ids are stable across reprocessing, so the ignore survives a rebuild; it goes
-- away with the prickle.
CREATE TABLE public.ignored_zoom_appearances (
    id text PRIMARY KEY DEFAULT public.new_id('igza'),
    prickle_id text NOT NULL REFERENCES public.prickles(id) ON DELETE CASCADE,
    zoom_name text NOT NULL,
    ignored_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    ignored_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (prickle_id, zoom_name)
);

COMMENT ON TABLE public.ignored_zoom_appearances IS
    'Zoom names an admin ignored for one prickle only; ignored_zoom_names ignores a name everywhere [id prefix: igza_]';

ALTER TABLE public.ignored_zoom_appearances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read ignored_zoom_appearances" ON public.ignored_zoom_appearances
    FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY "Admins can insert ignored_zoom_appearances" ON public.ignored_zoom_appearances
    FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Admins can delete ignored_zoom_appearances" ON public.ignored_zoom_appearances
    FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

GRANT SELECT, INSERT, DELETE ON public.ignored_zoom_appearances TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ignored_zoom_appearances TO service_role;
