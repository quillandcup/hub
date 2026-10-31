-- Notification sends are recorded for every member, including those who chose "leave me out of statistics"
-- (a send is something the app did, a record that it went out). Their opens are never recorded, though, so
-- counting their sends would make the open rate look lower than it is: the report leaves them out of both sides.
-- Same function as 20261126000100_analytics_outcomes_and_notifications.sql plus the opt-out condition.

CREATE OR REPLACE FUNCTION public.analytics_notification_rates(
    since timestamptz,
    ignore_staff boolean DEFAULT false,
    ignore_sudo boolean DEFAULT true
) RETURNS TABLE (kind text, channel text, sent bigint, sent_members bigint, opened bigint, opened_members bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
    SELECT
        e.properties ->> 'kind',
        e.properties ->> 'channel',
        count(*) FILTER (WHERE e.event = 'notification_sent'),
        count(DISTINCT e.user_id) FILTER (WHERE e.event = 'notification_sent'),
        count(*) FILTER (WHERE e.event = 'notification_opened'),
        count(DISTINCT e.user_id) FILTER (WHERE e.event = 'notification_opened')
    FROM analytics_events e
    WHERE e.event IN ('notification_sent', 'notification_opened')
      AND e.occurred_at >= since
      AND e.properties ? 'kind'
      AND e.properties ? 'channel'
      AND analytics_counts(e.sudo, e.user_id, ignore_sudo, ignore_staff)
      AND NOT EXISTS (
          SELECT 1 FROM user_profiles p WHERE p.id = e.user_id AND p.analytics_opt_out_at IS NOT NULL
      )
    GROUP BY 1, 2
    ORDER BY count(*) FILTER (WHERE e.event = 'notification_sent') DESC, 1, 2
    LIMIT 200;
$function$;
