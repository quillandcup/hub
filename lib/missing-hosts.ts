import { getMemberDisplayName } from "@/lib/member-display-name";
import type { Repos } from "@/lib/data/repos";
import type { HostCoverage } from "@/lib/data/prickles";

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

export type MissingHostsData = {
  /** Types that have unhosted calendar prickles: ones that need a host first, then by how many. */
  stats: UnhostedTypeStat[];
  coverage: HostCoverage;
  /** Active members, to pick a default host from. */
  members: { id: string; name: string; displayName: string | null; email: string }[];
};

/** What the Prickles Missing Hosts page shows, read through the repositories. */
export async function loadMissingHosts(repos: Pick<Repos, "prickles" | "members">): Promise<MissingHostsData> {
  const [counts, types, coverage, activeMembers] = await Promise.all([
    repos.prickles.hostlessCalendarCountsByType(),
    repos.prickles.types(),
    repos.prickles.hostCoverage("calendar"),
    repos.members.list({ status: "active", orderBy: "name" }),
  ]);

  const typesWithGaps = types.filter((t) => counts.has(t.id));
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

  return { stats, coverage, members: activeMembers.map(({ id, name, displayName, email }) => ({ id, name, displayName, email })) };
}
