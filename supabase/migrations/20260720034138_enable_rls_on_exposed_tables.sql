-- Fix Supabase security advisory: 17 tables in API-exposed schemas (public, bronze)
-- had RLS disabled, making them readable/writable by anyone with the anon key.
-- 5 of them (bronze slack_* and subscription_history) already had policies defined
-- but RLS was never turned on for the table, so the policies were never enforced.

-- Tables with existing policies: those policies were created directly against
-- the remote database (outside of migrations), so re-declare them here to bring
-- them under version control and keep local/remote in sync, then enable RLS.
DROP POLICY IF EXISTS "Authenticated users can modify slack_channels" ON bronze.slack_channels;
CREATE POLICY "Authenticated users can modify slack_channels"
    ON bronze.slack_channels FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');
ALTER TABLE bronze.slack_channels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can modify slack_messages" ON bronze.slack_messages;
CREATE POLICY "Authenticated users can modify slack_messages"
    ON bronze.slack_messages FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');
ALTER TABLE bronze.slack_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can modify slack_reactions" ON bronze.slack_reactions;
CREATE POLICY "Authenticated users can modify slack_reactions"
    ON bronze.slack_reactions FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');
ALTER TABLE bronze.slack_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can modify slack_users" ON bronze.slack_users;
CREATE POLICY "Authenticated users can modify slack_users"
    ON bronze.slack_users FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');
ALTER TABLE bronze.slack_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can modify subscription_history" ON bronze.subscription_history;
CREATE POLICY "Authenticated users can modify subscription_history"
    ON bronze.subscription_history FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');
ALTER TABLE bronze.subscription_history ENABLE ROW LEVEL SECURITY;

-- Tables with no policies yet: enable RLS and add the standard
-- "authenticated users only" policy used throughout this project.

-- bronze.kajabi_offers
ALTER TABLE bronze.kajabi_offers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view kajabi_offers"
    ON bronze.kajabi_offers FOR SELECT
    USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can modify kajabi_offers"
    ON bronze.kajabi_offers FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- bronze.kajabi_contacts
ALTER TABLE bronze.kajabi_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view kajabi_contacts"
    ON bronze.kajabi_contacts FOR SELECT
    USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can modify kajabi_contacts"
    ON bronze.kajabi_contacts FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- bronze.kajabi_customers
ALTER TABLE bronze.kajabi_customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view kajabi_customers"
    ON bronze.kajabi_customers FOR SELECT
    USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can modify kajabi_customers"
    ON bronze.kajabi_customers FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- bronze.kajabi_purchases
ALTER TABLE bronze.kajabi_purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view kajabi_purchases"
    ON bronze.kajabi_purchases FOR SELECT
    USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can modify kajabi_purchases"
    ON bronze.kajabi_purchases FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- bronze.stripe_subscriptions
ALTER TABLE bronze.stripe_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view stripe_subscriptions"
    ON bronze.stripe_subscriptions FOR SELECT
    USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can modify stripe_subscriptions"
    ON bronze.stripe_subscriptions FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- bronze.stripe_customers
ALTER TABLE bronze.stripe_customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view stripe_customers"
    ON bronze.stripe_customers FOR SELECT
    USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can modify stripe_customers"
    ON bronze.stripe_customers FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- bronze.stripe_products
ALTER TABLE bronze.stripe_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view stripe_products"
    ON bronze.stripe_products FOR SELECT
    USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can modify stripe_products"
    ON bronze.stripe_products FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- public.staff
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view staff"
    ON public.staff FOR SELECT
    USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can modify staff"
    ON public.staff FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- public.ignored_zoom_names
ALTER TABLE public.ignored_zoom_names ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view ignored_zoom_names"
    ON public.ignored_zoom_names FOR SELECT
    USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can modify ignored_zoom_names"
    ON public.ignored_zoom_names FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- public.ignored_slack_users
ALTER TABLE public.ignored_slack_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view ignored_slack_users"
    ON public.ignored_slack_users FOR SELECT
    USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can modify ignored_slack_users"
    ON public.ignored_slack_users FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- public.ambiguous_zoom_names
ALTER TABLE public.ambiguous_zoom_names ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view ambiguous_zoom_names"
    ON public.ambiguous_zoom_names FOR SELECT
    USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can modify ambiguous_zoom_names"
    ON public.ambiguous_zoom_names FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- public.member_email_aliases
ALTER TABLE public.member_email_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view member_email_aliases"
    ON public.member_email_aliases FOR SELECT
    USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can modify member_email_aliases"
    ON public.member_email_aliases FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');
