import { changedFields, formatValue, type ActivityFeedRow, type ResolvedRef } from "@/lib/activity-feed";
import { isId } from "@/lib/ids";

/** Client-safe half of audit-references: what to show for a row's details. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Fields with no value to the reader. */
const HIDDEN_FIELDS = new Set(["id", "updated_at", "updated_by"]);

/** Fields whose name reads better than the column's. */
const FIELD_LABELS: Record<string, string> = {
  created_by: "added by",
  user_id: "person",
  member_id: "member",
  prickle_id: "prickle",
  type_id: "type",
  host_id: "host",
  event_id: "event",
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field.replace(/_id$/, "").replace(/_/g, " ");
}

export function isReferenceValue(v: unknown): v is string {
  return typeof v === "string" && (UUID_RE.test(v) || (["mbr", "prkl", "prty", "evt"] as const).some((p) => isId(v, p)));
}

export interface DetailLine {
  field: string;
  label: string;
  old: ResolvedValue | null;
  new: ResolvedValue | null;
}
export interface ResolvedValue {
  text: string;
  href?: string;
}

function resolveValue(v: unknown, refs: Record<string, ResolvedRef>): ResolvedValue | null | "unresolved" {
  if (v === null || v === undefined) return null;
  if (isReferenceValue(v)) {
    const ref = refs[v];
    return ref ? { text: ref.label, href: ref.href } : "unresolved";
  }
  return { text: formatValue(v) };
}

/** The lines to show for an audit row's details: hidden fields and unresolvable ids dropped, ids replaced by names. */
export function detailLines(row: ActivityFeedRow): DetailLine[] {
  const refs = row.refs ?? {};
  const lines: DetailLine[] = [];
  for (const [field, change] of changedFields(row.data)) {
    if (HIDDEN_FIELDS.has(field)) continue;
    const o = resolveValue(change.old, refs);
    const n = resolveValue(change.new, refs);
    if (o === "unresolved" || n === "unresolved") continue;
    lines.push({ field, label: fieldLabel(field), old: o, new: n });
  }
  return lines;
}
