-- Check-in activity: also log edits and clears, not just the first answer.
--
-- Per half (check-in: feelings coming in / need; check-out: rating / feelings after):
--   first answered (or restored after a clear)  -> prickle_checkin / prickle_checkout
--   answers changed                             -> prickle_checkin_updated / prickle_checkout_updated
--   cleared (half emptied, or the whole check-in soft-deleted) -> prickle_checkin_cleared / prickle_checkout_cleared
-- A Slack DM saves one field at a time, so a change within 10 minutes of that half's last log folds
-- into it rather than logging a second row. Never the answers themselves.

CREATE OR REPLACE FUNCTION prickle_checkins_log_activity() RETURNS trigger AS $$
DECLARE
    half      text;
    type_name text;
    verb      text;
    kind      text;
    cur       boolean;
    was       boolean;
    changed   boolean;
    new_in    boolean := NEW.deleted_at IS NULL AND (cardinality(NEW.feelings_before) > 0 OR NEW.need IS NOT NULL);
    new_out   boolean := NEW.deleted_at IS NULL AND (NEW.session_rating IS NOT NULL OR cardinality(NEW.feelings_after) > 0);
    old_in    boolean := false;
    old_out   boolean := false;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        old_in  := OLD.deleted_at IS NULL AND (cardinality(OLD.feelings_before) > 0 OR OLD.need IS NOT NULL);
        old_out := OLD.deleted_at IS NULL AND (OLD.session_rating IS NOT NULL OR cardinality(OLD.feelings_after) > 0);
    END IF;

    SELECT pt.name INTO type_name
      FROM prickles p LEFT JOIN prickle_types pt ON pt.id = p.type_id WHERE p.id = NEW.prickle_id;

    FOREACH half IN ARRAY ARRAY['checkin', 'checkout'] LOOP
        cur := CASE half WHEN 'checkin' THEN new_in ELSE new_out END;
        was := CASE half WHEN 'checkin' THEN old_in ELSE old_out END;
        changed := TG_OP = 'UPDATE' AND CASE half
            WHEN 'checkin'  THEN (NEW.feelings_before, NEW.need) IS DISTINCT FROM (OLD.feelings_before, OLD.need)
            ELSE                 (NEW.session_rating, NEW.feelings_after) IS DISTINCT FROM (OLD.session_rating, OLD.feelings_after)
        END;

        IF cur AND NOT was THEN
            kind := 'prickle_' || half;
            verb := CASE half WHEN 'checkin' THEN 'Checked in to ' ELSE 'Checked out of ' END;
        ELSIF was AND NOT cur THEN
            kind := 'prickle_' || half || '_cleared';
            verb := CASE half WHEN 'checkin' THEN 'Cleared check-in for ' ELSE 'Cleared check-out for ' END;
        ELSIF cur AND was AND changed THEN
            -- Folds a multi-step save (Slack answers one field at a time) into the row it continues.
            CONTINUE WHEN EXISTS (
                SELECT 1 FROM member_activities
                 WHERE related_id = NEW.id::text AND source = 'prickle_checkins'
                   AND activity_type LIKE 'prickle_' || half || '%'
                   AND occurred_at > now() - interval '10 minutes');
            kind := 'prickle_' || half || '_updated';
            verb := CASE half WHEN 'checkin' THEN 'Updated check-in for ' ELSE 'Updated check-out for ' END;
        ELSE
            CONTINUE;
        END IF;

        INSERT INTO member_activities (member_id, activity_type, activity_category, title, prickle_id,
                                       related_id, engagement_value, occurred_at, source, actor_kind, data)
        VALUES (NEW.member_id, kind, 'event', verb || COALESCE(type_name, 'a prickle'),
                NEW.prickle_id, NEW.id::text, 0, now(), 'prickle_checkins', 'member',
                jsonb_build_object('via', NEW.saved_via));
    END LOOP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
