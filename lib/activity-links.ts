import { isId } from "@/lib/ids";
import type { ActivityFeedRow } from "@/lib/activity-feed";

export interface ActivityLink {
  href: string;
  label: string;
}

/**
 * Where an Activity Log row's source can be opened, if it has a page: the prickle a check-in or attendance was for, the
 * member an audited change was to, a member's own feedback. Links only carry readable ids (a prickle's, a member's), never
 * an id of a Tier 2 table (docs: "Resource ID Tiers"), which is why feedback goes to the list filtered to the member
 * rather than to the one item.
 */
export function activityLink(row: Pick<ActivityFeedRow, "kind" | "source" | "entity_type" | "entity_id" | "member_id">): ActivityLink | null {
  if (row.entity_type === "prickle" && isId(row.entity_id, "prkl")) return { href: `/admin/prickles/${row.entity_id}`, label: "Open the prickle" };
  if (row.kind === "audit" && row.entity_type === "member" && isId(row.entity_id, "mbr")) return { href: `/admin/members/${row.entity_id}`, label: "Open the member" };
  if (row.kind === "activity" && row.source === "feedback" && isId(row.member_id, "mbr")) return { href: `/admin/feedback?member=${row.member_id}`, label: "See their feedback" };
  return null;
}
