import { CARE_ENDED_HOW_LABELS, isCareEndedHow } from "@/lib/care-values";
import { planOrdinal } from "@/lib/care";
import { formatDateOnly } from "@/lib/formatters";
import { orgYmd } from "@/lib/org-week";

/**
 * Hedgie Care in the activity log (docs/architecture/ACTIVITY_AND_AUDIT_LOG.md, "A feature launches with its events in the activity log").
 * One pure module that says, in plain words, what happened to a care plan, so the central Activity Log (audit rows), a
 * member's Activity tab and the plan card's "Activity during this plan" (member_activities rows) read the same.
 *
 * Nothing the staff member typed (note, next step, a renewal's reason) is ever in a sentence or in the data a row carries: a
 * sentence is built from the kind of event, a fixed label (how it ended), a day, a colleague's name and a plan's number.
 */

export type CareEventKind =
  | "started"
  | "renewed"
  | "closed"
  | "offered"
  | "accepted"
  | "declined"
  | "cancelled"
  | "claimed"
  | "took_over"
  | "notice_seen"
  | "start_moved"
  | "edited"
  | "removed"
  | "restored";

/** What a sentence can say beyond the kind. Every field is optional: a missing one makes the sentence plainer, never wrong. */
export type CareEventContext = {
  /** A colleague's display name (the receiver of an offer, the owner it came from...). */
  name?: string | null;
  /** Which plan of a chain of renewals this is (the first is 1). */
  planNumber?: number | null;
  /** How it ended (a `CARE_ENDED_HOW` value). */
  endedHow?: string | null;
  /** An Eastern calendar day (YYYY-MM-DD): where a start moved to. */
  day?: string | null;
  /** The columns an edit changed, by name only. */
  fields?: readonly string[];
};

/** The `member_activities.source` of every care row. */
export const CARE_ACTIVITY_SOURCE = "care";

/** The `member_activities.activity_type` of each care event that has a row of its own (a moved start moves the start's row, a removal is audit only). */
export const CARE_ACTIVITY_TYPES = {
  started: "care_started",
  renewed: "care_renewed",
  closed: "care_closed",
  offered: "care_handover_offered",
  accepted: "care_handover_accepted",
  declined: "care_handover_declined",
  cancelled: "care_handover_cancelled",
  claimed: "care_plan_claimed",
  took_over: "care_plan_taken_over",
} as const satisfies Partial<Record<CareEventKind, string>>;

const KIND_BY_ACTIVITY_TYPE = new Map<string, CareEventKind>(Object.entries(CARE_ACTIVITY_TYPES).map(([kind, type]) => [type, kind as CareEventKind]));

/** The event a care activity type is, or null for a type this module does not know. */
export function careKindOfActivityType(type: string): CareEventKind | null {
  return KIND_BY_ACTIVITY_TYPE.get(type) ?? null;
}

/** The Activity Log title of each event that has a row (the sentence reads "<who> <sentence>" in the feed; the title stands alone). */
export const CARE_ACTIVITY_TITLES: Record<keyof typeof CARE_ACTIVITY_TYPES, string> = {
  started: "Started a care plan",
  renewed: "Renewed a care plan",
  closed: "Closed a care plan",
  offered: "Offered a care plan to a colleague",
  accepted: "Accepted a care plan from a colleague",
  declined: "Declined a care plan offered to them",
  cancelled: "Took back the offer of a care plan",
  claimed: "Took a care plan that had no owner",
  took_over: "Took over a care plan from a colleague",
};

const FIELD_NAMES: Record<string, string> = {
  reason: "reason",
  notes: "note",
  next_step: "next step",
  follow_up_on: "follow-up day",
};

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** "ran its course", "no reply": a fixed ending's label in the middle of a sentence. */
export function endedHowPhrase(endedHow: string | null | undefined): string | null {
  return endedHow && isCareEndedHow(endedHow) ? lowerFirst(CARE_ENDED_HOW_LABELS[endedHow]) : null;
}

/** What happened to a care plan, as the end of "<who> ...": "started a care plan", "renewed the care plan (second plan)". */
export function careSentence(kind: CareEventKind, context: CareEventContext = {}): string {
  const name = context.name?.trim() || null;
  switch (kind) {
    case "started":
      return "started a care plan";
    case "renewed":
      return context.planNumber && context.planNumber > 0 ? `renewed the care plan (${planOrdinal(context.planNumber)} plan)` : "renewed the care plan";
    case "closed": {
      const how = endedHowPhrase(context.endedHow);
      return how ? `closed the care plan: ${how}` : "closed the care plan";
    }
    case "offered":
      return `offered the care plan to ${name ?? "a colleague"}`;
    case "accepted":
      return name ? `accepted the care plan from ${name}` : "accepted a care plan";
    case "declined":
      return name ? `declined the care plan ${name} offered` : "declined an offered care plan";
    case "cancelled":
      return name ? `took back the offer of the care plan to ${name}` : "took back the offer of the care plan";
    case "claimed":
      return "took a care plan that had no owner";
    case "took_over":
      return name ? `took over the care plan from ${name}` : "took over a care plan";
    case "notice_seen":
      return "dismissed the notice that a care plan of theirs was taken over";
    case "start_moved":
      return context.day ? `moved the care plan's start to ${formatDateOnly(context.day)}` : "moved the care plan's start";
    case "edited": {
      const fields = (context.fields ?? []).map((f) => FIELD_NAMES[f]).filter((f): f is string => !!f);
      return fields.length > 0 ? `changed the care plan (${[...new Set(fields)].join(", ")})` : "changed the care plan";
    }
    case "removed":
      return "removed the care plan";
    case "restored":
      return "brought the care plan back";
  }
}

// ---------------------------------------------------------------------------
// From an audit row (`care_engagement`, the change to the plan's record)
// ---------------------------------------------------------------------------

type Change = { old: unknown; new: unknown };

/** What the audit row of a care plan's change is, read from its delta, with the names the feed resolved. Null for a row about something else. */
export function careEventOfAudit(row: {
  entity_type: string | null;
  event_type: string;
  actor_user_id: string | null;
  fields: Record<string, Change>;
  refs?: Record<string, { label: string }>;
  planNumber?: number;
}): { kind: CareEventKind; context: CareEventContext } | null {
  if (row.entity_type !== "care_engagement") return null;
  const f = row.fields;
  const label = (id: unknown) => (typeof id === "string" ? (row.refs?.[id]?.label ?? null) : null);
  if (row.event_type === "insert") {
    return f.renewed_from?.new ? { kind: "renewed", context: { planNumber: row.planNumber } } : { kind: "started", context: {} };
  }
  if (row.event_type === "delete") return { kind: "removed", context: {} };
  if (f.closed_at && !f.closed_at.old && f.closed_at.new) {
    return { kind: "closed", context: { endedHow: typeof f.ended_how?.new === "string" ? f.ended_how.new : null } };
  }
  if (f.owned_by) {
    // Four ways an owner changes. Someone takes a plan with no owner (the old owner is none). An admin takes a plan over from its owner
    // without an offer being accepted: the same row records the takeover (`taken_*`), whether or not an offer was waiting and cleared
    // with it, so it is read before the accept. Or the receiver accepts an offer: it is cleared in the same row, and the owner it came
    // from is the old one.
    if (!f.owned_by.old) return { kind: "claimed", context: {} };
    if (f.taken_at?.new) return { kind: "took_over", context: { name: label(f.owned_by.old) } };
    const offerCleared = !!f.handover_to && !!f.handover_to.old && !f.handover_to.new;
    return { kind: offerCleared ? "accepted" : "took_over", context: { name: label(f.owned_by.old) } };
  }
  if (f.handover_to) {
    if (f.handover_to.new) return { kind: "offered", context: { name: label(f.handover_to.new) } };
    // The offer went away without the plan changing hands: the receiver declined it, or someone took it back.
    const receiver = f.handover_to.old;
    if (receiver && receiver === row.actor_user_id) return { kind: "declined", context: { name: label(f.handover_by?.old) } };
    return { kind: "cancelled", context: { name: label(receiver) } };
  }
  // The previous owner dismissed the notice of a takeover (nothing else changed in the row).
  if (f.taken_seen_at?.new && !f.taken_seen_at.old) return { kind: "notice_seen", context: {} };
  if (f.opened_at) {
    const at = typeof f.opened_at.new === "string" ? new Date(f.opened_at.new) : null;
    return { kind: "start_moved", context: { day: at && !Number.isNaN(at.getTime()) ? orgYmd(at) : null } };
  }
  if (f.deleted_at) {
    return !f.deleted_at.old && f.deleted_at.new ? { kind: "removed", context: {} } : { kind: "restored", context: {} };
  }
  return { kind: "edited", context: { fields: Object.keys(f) } };
}

// ---------------------------------------------------------------------------
// From an activity row (`member_activities`, source `care`: the member's timeline)
// ---------------------------------------------------------------------------

/** The data a care row carries: fixed values and ids of staff accounts, never anything a person typed. */
export type CareActivityData = {
  plan_number?: number;
  ended_how?: string;
  from_user_id?: string;
  to_user_id?: string;
};

const asObject = (value: unknown): Record<string, unknown> => (value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

/** The ids of staff accounts a care row names, for the caller to resolve to display names. */
export function careActivityUserIds(data: unknown): string[] {
  const d = asObject(data);
  return [d.from_user_id, d.to_user_id].filter((id): id is string => typeof id === "string");
}

/** The sentence of a care activity row, or null when it is not one. `nameOf` turns a staff account id into a display name. */
export function careActivitySentence(row: { activity_type: string; data: unknown; description?: string | null }, nameOf: (userId: string) => string | null = () => null): string | null {
  const kind = careKindOfActivityType(row.activity_type);
  if (!kind) return null;
  const d = asObject(row.data);
  const user = (key: "from_user_id" | "to_user_id") => (typeof d[key] === "string" ? nameOf(d[key] as string) : null);
  switch (kind) {
    case "renewed":
      return careSentence(kind, { planNumber: typeof d.plan_number === "number" ? d.plan_number : null });
    case "closed":
      return careSentence(kind, { endedHow: typeof d.ended_how === "string" ? d.ended_how : endedHowOfDescription(row.description) });
    case "offered":
    case "cancelled":
      return careSentence(kind, { name: user("to_user_id") });
    case "accepted":
    case "declined":
    case "took_over":
      return careSentence(kind, { name: user("from_user_id") });
    default:
      return careSentence(kind);
  }
}

/** Rows written before `data.ended_how` held "<reason label>: <ending label>" in the description: both are fixed labels. */
function endedHowOfDescription(description: string | null | undefined): string | null {
  const tail = description?.split(": ").pop();
  const hit = Object.entries(CARE_ENDED_HOW_LABELS).find(([, label]) => label === tail);
  return hit ? hit[0] : null;
}
