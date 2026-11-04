import { getMemberDisplayName } from "@/lib/member-display-name";
import type { Repos } from "@/lib/data/repos";
import type { HostCoverage, PrickleDetail } from "@/lib/data/prickles";
import type { CalendarSourceEvent } from "@/lib/data/calendar-events";

/** How many of a type's unhosted prickles the detail view lists. */
export const UNHOSTED_LIST_LIMIT = 100;

/** One kind of prickle with calendar prickles that have no host. */
export type UnhostedTypeStat = {
  typeId: string;
  typeName: string;
  requiresHost: boolean;
  missingCount: number;
  defaultHostId: string | null;
  defaultHostName: string | null;
};

/** The unhosted calendar prickles that came from the same calendar entry title (every week of a recurring one). */
export type CalendarEntryGroup = {
  /** The title exactly as it is on the calendar, trimmed; empty when the entry has none. */
  summary: string;
  count: number;
  typeNames: string[];
  requiresHost: boolean;
  /** Who created the calendar entries (names only), most common first. */
  creators: string[];
  /** The description of the newest entry, which is where a host is often named. */
  description: string | null;
  newestStart: string;
  oldestStart: string;
  /** The newest few, to open. */
  prickles: { id: string; startTime: string }[];
};

/** How many prickles of a group the page links to. */
export const GROUP_PRICKLE_LINKS = 5;

export type MissingHostsData = {
  /** Types that have unhosted calendar prickles: ones that need a host first, then by how many. */
  stats: UnhostedTypeStat[];
  coverage: HostCoverage;
  /** The unhosted calendar prickles grouped by their calendar entry's title: types that need a host first, then the biggest groups. */
  groups: CalendarEntryGroup[];
  /** Every member, with their status: active ones to pick a default host from, any of them to credit as the host of past prickles. */
  members: { id: string; name: string; displayName: string | null; email: string; status: string }[];
};

/** What the Prickles Missing Hosts page shows, read through the repositories. */
export async function loadMissingHosts(repos: Pick<Repos, "prickles" | "members" | "calendarEvents">): Promise<MissingHostsData> {
  const [counts, types, coverage, allMembers, hostless] = await Promise.all([
    repos.prickles.hostlessCalendarCountsByType(),
    repos.prickles.types(),
    repos.prickles.hostCoverage("calendar"),
    repos.members.list({ orderBy: "name" }),
    repos.prickles.hostlessCalendar(),
  ]);
  const eventIds = [...new Set(hostless.filter((p) => p.type?.normalizedName !== "event").map((p) => p.calendarEventId).filter((id): id is string => !!id))];
  const events = await repos.calendarEvents.byIds(eventIds);

  const typesWithGaps = types.filter((t) => counts.has(t.id) && t.normalizedName !== "event");
  const defaultHosts = await repos.members.byIds([...new Set(typesWithGaps.map((t) => t.defaultHostId).filter((id): id is string => !!id))]);
  const hostName = new Map(defaultHosts.map((m) => [m.id, getMemberDisplayName({ name: m.name, display_name: m.displayName })]));

  const stats = typesWithGaps
    .map((t) => ({
      typeId: t.id,
      typeName: t.name,
      requiresHost: t.requiresHost,
      missingCount: counts.get(t.id)!,
      defaultHostId: t.defaultHostId ?? null,
      defaultHostName: t.defaultHostId ? (hostName.get(t.defaultHostId) ?? null) : null,
    }))
    // Types that need a host first, then the ones with the most gaps.
    .sort((a, b) => (a.requiresHost === b.requiresHost ? b.missingCount - a.missingCount : a.requiresHost ? -1 : 1));

  return { stats, coverage, groups: groupByCalendarEntry(hostless, events), members: allMembers.map(({ id, name, displayName, email, status }) => ({ id, name, displayName, email, status })) };
}

/**
 * Groups unhosted calendar prickles by the title of the calendar entry they came from, so one unmatched name
 * ("Prickle w/AJ") shows once with how many prickles it affects. The Event type is left out, as on the stats.
 */
export function groupByCalendarEntry(
  prickles: PrickleDetail[],
  events: Pick<CalendarSourceEvent, "id" | "summary" | "description" | "creator_name">[],
): CalendarEntryGroup[] {
  const eventById = new Map(events.map((e) => [e.id, e]));
  const groups = new Map<string, { group: CalendarEntryGroup; creators: Map<string, number> }>();

  // Newest first, so the first prickle of a group is its newest.
  for (const p of prickles) {
    if (p.type?.normalizedName === "event") continue;
    const event = p.calendarEventId ? eventById.get(p.calendarEventId) : undefined;
    const summary = (event?.summary ?? p.title ?? "").trim();
    const key = summary.toLowerCase();
    let entry = groups.get(key);
    if (!entry) {
      entry = {
        group: {
          summary,
          count: 0,
          typeNames: [],
          requiresHost: false,
          creators: [],
          description: event?.description?.trim() || null,
          newestStart: p.startTime,
          oldestStart: p.startTime,
          prickles: [],
        },
        creators: new Map(),
      };
      groups.set(key, entry);
    }
    const g = entry.group;
    g.count++;
    g.oldestStart = p.startTime;
    if (p.type) {
      if (!g.typeNames.includes(p.type.name)) g.typeNames.push(p.type.name);
      if (p.type.requiresHost) g.requiresHost = true;
    }
    const creator = event?.creator_name?.trim();
    if (creator) entry.creators.set(creator, (entry.creators.get(creator) ?? 0) + 1);
    if (g.prickles.length < GROUP_PRICKLE_LINKS) g.prickles.push({ id: p.id, startTime: p.startTime });
  }

  return [...groups.values()]
    .map(({ group, creators }) => ({ ...group, creators: [...creators].sort((a, b) => b[1] - a[1]).map(([name]) => name) }))
    .sort((a, b) => (a.requiresHost === b.requiresHost ? b.count - a.count || a.summary.localeCompare(b.summary) : a.requiresHost ? -1 : 1));
}
