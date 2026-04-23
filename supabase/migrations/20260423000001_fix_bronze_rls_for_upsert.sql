-- Fix Bronze table RLS policies to support UPSERT operations
-- UPSERT requires both INSERT and UPDATE permissions, but some tables only had INSERT policies

-- zoom_attendees
DROP POLICY IF EXISTS "Authenticated users can insert zoom_attendees" ON bronze.zoom_attendees;
DROP POLICY IF EXISTS "Authenticated users can modify zoom_attendees" ON bronze.zoom_attendees;

CREATE POLICY "Authenticated users can modify zoom_attendees"
    ON bronze.zoom_attendees FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- kajabi_members
DROP POLICY IF EXISTS "Authenticated users can insert kajabi_members" ON bronze.kajabi_members;
DROP POLICY IF EXISTS "Authenticated users can modify kajabi_members" ON bronze.kajabi_members;

CREATE POLICY "Authenticated users can modify kajabi_members"
    ON bronze.kajabi_members FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- zoom_meetings (verify it has correct policy)
DROP POLICY IF EXISTS "Authenticated users can insert zoom_meetings" ON bronze.zoom_meetings;
DROP POLICY IF EXISTS "Authenticated users can modify zoom_meetings" ON bronze.zoom_meetings;

CREATE POLICY "Authenticated users can modify zoom_meetings"
    ON bronze.zoom_meetings FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- slack tables (check if they exist and add policies)
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'bronze' AND tablename = 'slack_users') THEN
        DROP POLICY IF EXISTS "Authenticated users can insert slack_users" ON bronze.slack_users;
        DROP POLICY IF EXISTS "Authenticated users can modify slack_users" ON bronze.slack_users;
        CREATE POLICY "Authenticated users can modify slack_users"
            ON bronze.slack_users FOR ALL
            USING (auth.role() = 'authenticated')
            WITH CHECK (auth.role() = 'authenticated');
    END IF;

    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'bronze' AND tablename = 'slack_channels') THEN
        DROP POLICY IF EXISTS "Authenticated users can insert slack_channels" ON bronze.slack_channels;
        DROP POLICY IF EXISTS "Authenticated users can modify slack_channels" ON bronze.slack_channels;
        CREATE POLICY "Authenticated users can modify slack_channels"
            ON bronze.slack_channels FOR ALL
            USING (auth.role() = 'authenticated')
            WITH CHECK (auth.role() = 'authenticated');
    END IF;

    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'bronze' AND tablename = 'slack_messages') THEN
        DROP POLICY IF EXISTS "Authenticated users can insert slack_messages" ON bronze.slack_messages;
        DROP POLICY IF EXISTS "Authenticated users can modify slack_messages" ON bronze.slack_messages;
        CREATE POLICY "Authenticated users can modify slack_messages"
            ON bronze.slack_messages FOR ALL
            USING (auth.role() = 'authenticated')
            WITH CHECK (auth.role() = 'authenticated');
    END IF;

    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'bronze' AND tablename = 'slack_reactions') THEN
        DROP POLICY IF EXISTS "Authenticated users can insert slack_reactions" ON bronze.slack_reactions;
        DROP POLICY IF EXISTS "Authenticated users can modify slack_reactions" ON bronze.slack_reactions;
        CREATE POLICY "Authenticated users can modify slack_reactions"
            ON bronze.slack_reactions FOR ALL
            USING (auth.role() = 'authenticated')
            WITH CHECK (auth.role() = 'authenticated');
    END IF;

    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'bronze' AND tablename = 'subscription_history') THEN
        DROP POLICY IF EXISTS "Authenticated users can insert subscription_history" ON bronze.subscription_history;
        DROP POLICY IF EXISTS "Authenticated users can modify subscription_history" ON bronze.subscription_history;
        CREATE POLICY "Authenticated users can modify subscription_history"
            ON bronze.subscription_history FOR ALL
            USING (auth.role() = 'authenticated')
            WITH CHECK (auth.role() = 'authenticated');
    END IF;
END $$;
