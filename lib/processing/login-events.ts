import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAliasMap, resolveEmail } from "@/lib/email-aliases";

interface LoginSessionRow {
  session_id: string;
  user_id: string;
  email: string | null;
  created_at: string;
}

/**
 * Mirror recent Hedgie Hub logins into member_activities.
 *
 * auth.sessions/auth.users aren't exposed over PostgREST, so recent sessions
 * come from get_recent_login_sessions() (SECURITY DEFINER, service-role
 * only — see its migration). Matches primarily via members.user_id (direct
 * FK, populated by the invite-time link in app/api/admin/users/route.ts and
 * the one-time backfill migration); falls back to email resolution for the
 * rare member whose user_id is still unset.
 *
 * Dedupes against the partial unique index on (source, related_id) WHERE
 * source = 'access_events' by checking which session ids already have a
 * mirror row before inserting — Postgres won't let a plain `.upsert()`
 * target a partial index via PostgREST's onConflict option (the ON CONFLICT
 * clause it generates has no way to carry the index's WHERE predicate), so
 * this is select-then-insert rather than a single upsert call. The index
 * still backstops it against a genuine race.
 */
export async function mirrorLoginEvents(
  supabase: SupabaseClient,
  { from, to }: { from: Date; to: Date }
) {
  const { data: sessions, error: sessionsError } = await supabase.rpc(
    "get_recent_login_sessions",
    { from_date: from.toISOString(), to_date: to.toISOString() }
  );
  if (sessionsError) throw sessionsError;

  const loginSessions = (sessions ?? []) as LoginSessionRow[];
  if (loginSessions.length === 0) {
    return { sessionsSeen: 0, activitiesUpserted: 0 };
  }

  const [{ data: members, error: membersError }, { data: emailAliases, error: aliasesError }] =
    await Promise.all([
      supabase.from("members").select("id, user_id, email"),
      supabase.from("member_email_aliases").select("*").eq("active", true),
    ]);
  if (membersError) throw membersError;
  if (aliasesError) throw aliasesError;

  const memberIdByUserId = new Map<string, string>();
  const memberIdByEmail = new Map<string, string>();
  for (const m of members ?? []) {
    if (m.user_id) memberIdByUserId.set(m.user_id, m.id);
    if (m.email) memberIdByEmail.set(m.email.toLowerCase(), m.id);
  }
  const aliasMap = buildAliasMap(emailAliases ?? []);

  const activities = loginSessions
    .map((session) => {
      const memberId =
        memberIdByUserId.get(session.user_id) ??
        (session.email ? memberIdByEmail.get(resolveEmail(session.email, aliasMap)) : undefined);
      if (!memberId) return null;

      return {
        member_id: memberId,
        activity_type: "hedgie_hub_login",
        activity_category: "engagement",
        title: "Logged into Hedgie Hub",
        actor_kind: "member" as const,
        engagement_value: 1,
        occurred_at: session.created_at,
        source: "access_events",
        related_id: session.session_id,
      };
    })
    .filter((a): a is NonNullable<typeof a> => a !== null);

  if (activities.length === 0) {
    return { sessionsSeen: loginSessions.length, activitiesInserted: 0 };
  }

  const { data: existing, error: existingError } = await supabase
    .from("member_activities")
    .select("related_id")
    .eq("source", "access_events")
    .in("related_id", activities.map((a) => a.related_id));
  if (existingError) throw existingError;

  const alreadyMirrored = new Set((existing ?? []).map((e) => e.related_id));
  const newActivities = activities.filter((a) => !alreadyMirrored.has(a.related_id));

  if (newActivities.length === 0) {
    return { sessionsSeen: loginSessions.length, activitiesInserted: 0 };
  }

  const { error: insertError } = await supabase.from("member_activities").insert(newActivities);
  if (insertError) throw insertError;

  return { sessionsSeen: loginSessions.length, activitiesInserted: newActivities.length };
}
