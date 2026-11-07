import type { SupabaseClient } from "@supabase/supabase-js";
import { createRepos } from "@/lib/data/repos";
import { getMemberDisplayName } from "@/lib/member-display-name";
import { formatPrickleTitle } from "@/lib/formatters";
import { isId } from "@/lib/ids";
import { changedFields, type ActivityFeedRow, type ResolvedRef } from "@/lib/activity-feed";
import { isReferenceValue, UUID_RE } from "@/lib/audit-details";

/**
 * Makes the details of an audit row readable: the row's own id and other pure plumbing are left out, and a
 * field that holds the id of something we know (a member, a prickle, a prickle type, a signed-in account) shows
 * that thing's name instead, linked where there is an admin page for it. Only Tier 1 ids are ever linked
 * (CLAUDE.md, "Resource ID Tiers"); an id we could not resolve is left out rather than shown raw.
 */

/** Every id-shaped value in a page of audit rows' deltas. */
export function referencedIds(rows: ActivityFeedRow[]): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.kind !== "audit") continue;
    for (const [, change] of changedFields(row.data)) {
      for (const v of [change.old, change.new]) if (isReferenceValue(v)) ids.add(v);
    }
  }
  return [...ids];
}

/** Resolve every referenced id of `rows` in a handful of batched reads and attach them as `refs`. */
export async function withReferenceNames(supabase: SupabaseClient, rows: ActivityFeedRow[]): Promise<ActivityFeedRow[]> {
  const ids = referencedIds(rows);
  if (ids.length === 0) return rows;
  const repos = createRepos(supabase);
  const refs: Record<string, ResolvedRef> = {};

  const memberIds = ids.filter((i) => isId(i, "mbr"));
  const userIds = ids.filter((i) => UUID_RE.test(i));
  const prickleIds = ids.filter((i) => isId(i, "prkl"));
  const typeIds = ids.filter((i) => isId(i, "prty"));

  const memberByUser = userIds.length > 0 ? await repos.members.idsByUserId(userIds) : new Map<string, string>();
  const allMemberIds = [...new Set([...memberIds, ...memberByUser.values()])];
  const [members, prickles, types] = await Promise.all([
    allMemberIds.length > 0 ? repos.members.byIds(allMemberIds) : Promise.resolve([]),
    prickleIds.length > 0 ? repos.prickles.byIds(prickleIds) : Promise.resolve([]),
    typeIds.length > 0 ? repos.prickles.types() : Promise.resolve([]),
  ]);

  const memberRef = new Map<string, ResolvedRef>();
  for (const m of members) {
    memberRef.set(m.id, { label: getMemberDisplayName({ name: m.name, display_name: m.displayName }), href: `/admin/members/${m.id}` });
  }
  for (const id of memberIds) if (memberRef.has(id)) refs[id] = memberRef.get(id)!;
  for (const [userId, memberId] of memberByUser) if (memberRef.has(memberId)) refs[userId] = memberRef.get(memberId)!;
  for (const p of prickles) {
    const when = new Date(p.startTime).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
    refs[p.id] = {
      label: `${formatPrickleTitle({ title: p.title, start_time: p.startTime, prickle_types: p.type ? { name: p.type.name } : undefined })} · ${when}`,
      href: `/admin/prickles/${p.id}`,
    };
  }
  for (const t of types) if (typeIds.includes(t.id)) refs[t.id] = { label: t.name };

  return rows.map((r) => (r.kind === "audit" ? { ...r, refs } : r));
}
