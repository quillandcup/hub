-- Billing reconciliation acknowledgements: staff record WHY a row of the billing reconciliation is as it is (a purchase
-- that was comped, a month gifted, a non-refundable payment forfeited, a payment made outside Stripe). An acknowledged
-- row leaves the to-do count and its decision stays visible. docs/architecture/BILLING_RECONCILIATION.md, "Acknowledging a row".
--
-- The row is bound to what staff saw: row_key (the reconciliation row's stable key), the status it had and the amount at
-- stake. When the row changes later, the app stops applying the acknowledgement. Never deleted: revoking sets revoked_at
-- and revoked_by, and a new acknowledgement is a new row (one ACTIVE one per row_key).
-- Expand only: a new table; nothing existing changes. Admin only (permission billing.reconciliation.acknowledge).

set lock_timeout = '5s';

CREATE TABLE public.billing_acknowledgements (
  id text PRIMARY KEY DEFAULT public.new_id('brak'),
  row_key text NOT NULL CHECK (btrim(row_key) <> ''),
  member_id text NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  purchase_type text NOT NULL CHECK (purchase_type IN ('membership', 'event', 'program', 'course')),
  reason text NOT NULL CHECK (reason IN ('gift', 'comp', 'forfeited', 'paid_elsewhere', 'other')),
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  status_at_ack text NOT NULL CHECK (btrim(status_at_ack) <> ''),
  amount_cents_at_ack bigint CHECK (amount_cents_at_ack IS NULL OR amount_cents_at_ack >= 0),
  acknowledged_by uuid REFERENCES auth.users(id),
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  revoked_by uuid REFERENCES auth.users(id),
  revoked_at timestamptz,
  CONSTRAINT billing_acknowledgements_other_needs_note CHECK (reason <> 'other' OR (note IS NOT NULL AND btrim(note) <> '')),
  CONSTRAINT billing_acknowledgements_revoked_together CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);

-- One active acknowledgement per row; the revoked ones are history.
CREATE UNIQUE INDEX billing_acknowledgements_one_active ON public.billing_acknowledgements (row_key) WHERE revoked_at IS NULL;
CREATE INDEX idx_billing_acknowledgements_member_id ON public.billing_acknowledgements (member_id);

COMMENT ON TABLE public.billing_acknowledgements IS
  'Local: why a billing reconciliation row is as it is (gift, comp, forfeited, paid elsewhere, other), bound to the row key, its status and its amount when staff marked it. Revoked, never deleted. Admin only. [id prefix: brak_]';

-- The decision is history: once written, only a revoke (revoked_at, revoked_by) may change it, and only once.
CREATE FUNCTION public.billing_acknowledgements_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'A revoked acknowledgement cannot be changed';
  END IF;
  IF (to_jsonb(NEW) - 'revoked_at' - 'revoked_by') IS DISTINCT FROM (to_jsonb(OLD) - 'revoked_at' - 'revoked_by') THEN
    RAISE EXCEPTION 'An acknowledgement can only be revoked, not edited';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER billing_acknowledgements_append_only BEFORE UPDATE ON public.billing_acknowledgements
  FOR EACH ROW EXECUTE FUNCTION public.billing_acknowledgements_append_only();

ALTER TABLE public.billing_acknowledgements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view billing_acknowledgements" ON public.billing_acknowledgements
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY "Admins can insert billing_acknowledgements" ON public.billing_acknowledgements
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Admins can update billing_acknowledgements" ON public.billing_acknowledgements
  FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

-- No DELETE for anyone: an acknowledgement is revoked, never removed (a deleted member takes theirs along through the foreign key).
REVOKE ALL ON public.billing_acknowledgements FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.billing_acknowledgements TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.billing_acknowledgements TO service_role;

-- The Activity Log: the mark and the revoke, one entry each. The note is staff's own words, so it is logged as changed and never with its value.
CREATE TRIGGER audit_row_change AFTER INSERT OR UPDATE ON public.billing_acknowledgements
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('billing_acknowledgement', 'id', 'note');

INSERT INTO public.member_data_handling (table_name, column_name, action, why)
VALUES ('billing_acknowledgements', 'member_id', 'delete', 'a staff decision about the member''s billing, with a free-text note that can name them');
