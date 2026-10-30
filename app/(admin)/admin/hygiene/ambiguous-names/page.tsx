import { createRepos } from "@/lib/data/repos";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import AmbiguousNamesResolver from "./AmbiguousNamesResolver";
import { requireAdminPage } from "@/lib/admin-auth";
import { matchAttendeeToMember } from "@/lib/member-matching";

export const metadata: Metadata = {
  title: "Ambiguous Zoom Names",
};

export const dynamic = "force-dynamic";

export default async function AmbiguousNamesPage() {
  await requireAdminPage();
  const supabase = await createClient();

  const repos = createRepos(supabase);
  const [{ data: ambiguousRows }, allMembers, aliases, emailAliases] = await Promise.all([
    supabase.from("ambiguous_zoom_names").select("zoom_name, zoom_email").eq("status", "unresolved"),
    repos.members.identities(),
    repos.aliases.nameAliases({ activeOnly: true }),
    repos.aliases.emailAliases({ activeOnly: true }),
  ]);

  const membersById = new Map(allMembers.map((m) => [m.id, { id: m.id, name: m.name, displayName: m.displayName, email: m.email }]));

  // The stored rows are only the queue of names to decide on. Whether a name is still ambiguous,
  // who the candidates are, how often it appears and when it was last seen are worked out here from
  // the current members, aliases and Zoom attendees, so a stored count can't drift and a name that
  // stopped being ambiguous (a member merged or aliased) drops off by itself.
  const attendeeKey = (name: string, email: string | null) => `${name}|${email || ""}`;
  const stillAmbiguous = new Map<string, { zoomName: string; zoomEmail: string | null; candidateIds: string[] }>();
  for (const row of ambiguousRows ?? []) {
    const match = matchAttendeeToMember(row.zoom_name, row.zoom_email, allMembers, aliases, emailAliases);
    if (!match || !("reason" in match)) continue;
    stillAmbiguous.set(attendeeKey(row.zoom_name, row.zoom_email), {
      zoomName: row.zoom_name,
      zoomEmail: row.zoom_email,
      candidateIds: match.candidates.map((c) => c.id),
    });
  }

  type Occurrence = { topic: string | null; joinTime: string; meetingKey: string };
  const usage = new Map<string, { count: number; lastSeenAt: string; occurrences: Occurrence[] }>();
  const names = [...new Set([...stillAmbiguous.values()].map((r) => r.zoomName))];
  if (names.length > 0) {
    const BATCH_SIZE = 1000;
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      const { data: batch, error } = await supabase
        .schema("bronze")
        .from("zoom_attendees")
        .select("name, email, join_time, topic, meeting_uuid, meeting_id")
        .in("name", names)
        .order("id")
        .range(offset, offset + BATCH_SIZE - 1);
      if (error) throw error;
      for (const a of batch ?? []) {
        const key = attendeeKey(a.name, a.email);
        const seen = usage.get(key) ?? { count: 0, lastSeenAt: "", occurrences: [] };
        seen.count++;
        seen.occurrences.push({ topic: a.topic, joinTime: a.join_time, meetingKey: a.meeting_uuid || a.meeting_id });
        if (a.join_time > seen.lastSeenAt) seen.lastSeenAt = a.join_time;
        usage.set(key, seen);
      }
      offset += batch?.length ?? 0;
      hasMore = (batch?.length ?? 0) === BATCH_SIZE;
    }
  }

  // Who else was in those sessions. Another attendee whose own name matches exactly one member
  // counts as that member, so an admin can ask the people most often there with this name which
  // person it is. The candidates themselves are left out: they are the ones in question.
  const meetingKeys = new Set<string>();
  for (const seen of usage.values()) for (const o of seen.occurrences) meetingKeys.add(o.meetingKey);
  const attendeesByMeeting = new Map<string, Array<{ name: string; email: string | null }>>();
  {
    const keys = [...meetingKeys];
    const KEY_CHUNK = 50;
    const BATCH_SIZE = 1000;
    for (let i = 0; i < keys.length; i += KEY_CHUNK) {
      const chunk = keys.slice(i, i + KEY_CHUNK);
      // The attendance run groups by meeting_uuid, falling back to meeting_id; look up both.
      for (const column of ["meeting_uuid", "meeting_id"] as const) {
        let offset = 0;
        let hasMore = true;
        while (hasMore) {
          const { data: batch, error } = await supabase
            .schema("bronze")
            .from("zoom_attendees")
            .select("name, email, meeting_uuid, meeting_id")
            .in(column, chunk)
            .order("id")
            .range(offset, offset + BATCH_SIZE - 1);
          if (error) throw error;
          for (const a of batch ?? []) {
            const key = a.meeting_uuid || a.meeting_id;
            if (!chunk.includes(key)) continue;
            const list = attendeesByMeeting.get(key) ?? [];
            list.push({ name: a.name, email: a.email });
            attendeesByMeeting.set(key, list);
          }
          offset += batch?.length ?? 0;
          hasMore = (batch?.length ?? 0) === BATCH_SIZE;
        }
      }
    }
  }
  // The same row can come back from both lookups; count each person once per session.
  const memberIdByAttendee = new Map<string, string | null>();
  const memberOf = (a: { name: string; email: string | null }) => {
    const key = attendeeKey(a.name, a.email);
    if (!memberIdByAttendee.has(key)) {
      const m = matchAttendeeToMember(a.name, a.email, allMembers, aliases, emailAliases);
      memberIdByAttendee.set(key, m && "member_id" in m ? m.member_id : null);
    }
    return memberIdByAttendee.get(key)!;
  };

  // Group by zoom_name only: the same bare name can be stored with and without an email.
  const groups = new Map<
    string,
    { occurrenceCount: number; lastSeenAt: string; candidateIds: Set<string>; occurrences: Occurrence[] }
  >();
  for (const [key, row] of stillAmbiguous) {
    const seen = usage.get(key);
    const group = groups.get(row.zoomName) ?? { occurrenceCount: 0, lastSeenAt: "", candidateIds: new Set<string>(), occurrences: [] };
    group.occurrenceCount += seen?.count ?? 0;
    group.occurrences.push(...(seen?.occurrences ?? []));
    if ((seen?.lastSeenAt ?? "") > group.lastSeenAt) group.lastSeenAt = seen!.lastSeenAt;
    for (const id of row.candidateIds) group.candidateIds.add(id);
    groups.set(row.zoomName, group);
  }

  const SESSIONS_SHOWN = 30;
  const COMPANIONS_SHOWN = 6;
  const entriesWithMeetings = Array.from(groups.entries())
    .map(([zoomName, g]) => {
      const sessionsWithCompany = new Map<string, number>();
      for (const meetingKey of new Set(g.occurrences.map((o) => o.meetingKey))) {
        const here = new Set<string>();
        for (const a of attendeesByMeeting.get(meetingKey) ?? []) {
          const id = memberOf(a);
          if (id && !g.candidateIds.has(id)) here.add(id);
        }
        for (const id of here) sessionsWithCompany.set(id, (sessionsWithCompany.get(id) ?? 0) + 1);
      }
      const companions = [...sessionsWithCompany]
        .sort((a, b) => b[1] - a[1])
        .slice(0, COMPANIONS_SHOWN)
        .flatMap(([id, sessions]) => {
          const m = membersById.get(id);
          return m ? [{ id, name: m.name, displayName: m.displayName, sessions }] : [];
        });
      return {
        zoomName,
        occurrenceCount: g.occurrenceCount,
        lastSeenAt: g.lastSeenAt,
        candidates: Array.from(g.candidateIds)
          .map((id) => membersById.get(id))
          .filter((m): m is { id: string; name: string; displayName: string | null; email: string } => !!m),
        sessions: g.occurrences
          .sort((a, b) => (a.joinTime < b.joinTime ? 1 : -1))
          .slice(0, SESSIONS_SHOWN)
          .map((o) => ({ topic: o.topic, joinTime: o.joinTime, meetingKey: o.meetingKey })),
        companions,
      };
    })
    .sort((a, b) => b.occurrenceCount - a.occurrenceCount);

  // Link each listed session to its prickle: a pop-up prickle carries the Zoom meeting's uuid, a
  // calendar prickle is the one running when the person joined. Ambiguous attendees have no
  // attendance, so the join time is all that ties the session to a prickle.
  const shown = entriesWithMeetings.flatMap((e) => e.sessions);
  const popUps = await repos.prickles.byZoomMeetings([...new Set(shown.map((x) => x.meetingKey))]);
  const joinTimes = shown.map((x) => x.joinTime).sort();
  const calendar =
    joinTimes.length > 0
      ? await repos.prickles.calendarOverlapping({ from: joinTimes[0], to: new Date(new Date(joinTimes[joinTimes.length - 1]).getTime() + 1000).toISOString() })
      : [];
  const prickleIdFor = (session: { joinTime: string; meetingKey: string }) => {
    const during = (p: { startTime: string; endTime: string }) => p.startTime <= session.joinTime && session.joinTime < p.endTime;
    const popUp = popUps.filter((p) => p.zoomMeetingUuid === session.meetingKey);
    return (popUp.find(during) ?? calendar.find(during) ?? popUp[0])?.id ?? null;
  };
  const entries = entriesWithMeetings.map((e) => ({
    ...e,
    sessions: e.sessions.map(({ meetingKey, ...session }) => ({ ...session, prickleId: prickleIdFor({ ...session, meetingKey }) })),
  }));

  return (
    <div className="container mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Ambiguous Zoom Names</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          These Zoom display names matched more than one member, so attendance processing
          skipped them entirely — no attendance record was written for anyone, silently
          producing false no-shows. Assign each name to the member it actually belongs to.
        </p>
      </div>

      <AmbiguousNamesResolver entries={entries} />
    </div>
  );
}
