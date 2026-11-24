import type { SupabaseClient } from "@supabase/supabase-js";
import { pageBounds } from "@/lib/pagination";
import { isAnyId, isId } from "@/lib/ids";
import { withMentionNames } from "@/lib/chat/names";
import { createRepos } from "@/lib/data/repos";
import { throwIfDbError } from "@/lib/db-error";
import { getMemberDisplayName } from "@/lib/member-display-name";
import { milestoneLabel } from "@/lib/finishers";
import { FEATURE_PREVIEWS } from "@/lib/features";
import { withReferenceNames } from "@/lib/audit-references";
import { careActivitySentence, careEventOfAudit, careSentence } from "@/lib/care-events";
import { ROLE_LABELS, isStaffRole } from "@/lib/permissions";
import { periodNumber } from "@/lib/care";
import { allTimeStart, describeRange, parseDayRange, rangeInstants, type DayRange } from "@/lib/activity-range";

/**
 * The central activity log: audit_log rows, member_activities rows and page
 * visit sessions in one shape, from the get_activity_feed() SQL function (see
 * docs/architecture/ACTIVITY_AND_AUDIT_LOG.md). The function enforces admin-only itself.
 */

export type FeedKind = "audit" | "activity" | "session" | "note";
export const FEED_KINDS: readonly FeedKind[] = ["audit", "activity", "session", "note"];

export const FEED_KIND_LABELS: Record<FeedKind, string> = {
  audit: "Changes",
  activity: "Member activity",
  session: "Page visits",
  note: "Notes",
};

export interface ActivityFeedRow {
  event_id: string;
  kind: FeedKind;
  occurred_at: string;
  is_audit: boolean;
  actor_user_id: string | null;
  actor_kind: "member" | "staff" | "system";
  actor_label: string | null;
  member_id: string | null;
  member_name: string | null;
  /** Set when an admin did this in sudo: the member they were viewing as. */
  acting_as_member_id: string | null;
  acting_as_member_name: string | null;
  event_type: string;
  entity_type: string | null;
  entity_id: string | null;
  title: string | null;
  description: string | null;
  source: string | null;
  data: Record<string, unknown> | null;
  /** Names (and admin pages) of the ids in an audit row's details, by id; set by the fetchers. */
  refs?: Record<string, ResolvedRef>;
  /** On the audit row of a renewed care plan: which plan of the chain it is (the first is 1); set by the fetchers. */
  planNumber?: number;
}

export interface ResolvedRef {
  label: string;
  href?: string;
}

/**
 * Audit entity types behind the Privacy view: who changed which channels staff can
 * read, and who opened the messages of a member's Hedgie Care plans (`care_dm_read`, written by
 * `care_log_messages_read`; the entry names the reader and the member, never any text). Break-glass
 * grants and reads join this list when they exist (docs/product/SLACK_BRIDGED_CHAT.md, "Access control").
 */
export const PRIVACY_ENTITY_TYPES: readonly string[] = ["restricted_slack_channel", "care_dm_read"];

export type FeedView = "audit" | "all" | "privacy";

export interface FeedFilters {
  /**
   * "audit" = only audit-worthy rows (staff/system writes, sudo); "all" = everything;
   * "privacy" = only changes to who can read message content.
   */
  view: FeedView;
  kinds: FeedKind[] | null;
  actorUserId: string | null;
  memberId: string | null;
  /** Only things done by an admin while viewing as a member. */
  sudoOnly: boolean;
  /** Drop rows the system did (cron, imports, triggers with no user). */
  hideSystem: boolean;
  /** Drop member activity that came from Slack (by far the most numerous). */
  hideSlack: boolean;
  /** Look-back window in days; `ALL_TIME_DAYS` for no limit. Ignored while `range` is set. */
  days: number;
  /**
   * A custom range of Eastern days (?from=&to=), which wins over `days`. Only a feed that offers it (`FeedDefaults.rangeFilter`:
   * a member's Activity tab) reads it from the URL; the central log has no range yet and leaves it out.
   */
  range?: DayRange | null;
  /** Why the URL's range was not used (a short sentence), for the page to show; null when it was fine. */
  rangeNotice?: string | null;
}

/** Filters plus where in the result set we are; page/pageSize come from ?page=&pageSize=. */
export interface FeedQuery extends FeedFilters {
  page: number;
  pageSize: number;
}

export const FEED_DAY_OPTIONS = [1, 7, 30, 90, 365] as const;

/** `days` for "all time" (?days=all): from the start of the range floor, no look-back to count. */
export const ALL_TIME_DAYS = 0;

/** What a feed shows when its URL has no ?view= / ?days=: the central log is audit-first, a member's page shows everything. */
export interface FeedDefaults {
  view: FeedView;
  days: number;
  /** Also offer "all time" and a custom From/To range (?days=all, ?from=&to=). */
  rangeFilter?: boolean;
}
export const CENTRAL_DEFAULTS: FeedDefaults = { view: "audit", days: 7 };
export const MEMBER_DEFAULTS: FeedDefaults = { view: "all", days: 90, rangeFilter: true };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Param = string | string[] | undefined;
const first = (v: Param) => (Array.isArray(v) ? v[0] : v);

function parseView(view: string | undefined, fallback: FeedView): FeedView {
  return view === "audit" || view === "all" || view === "privacy" ? view : fallback;
}

export function parseFeedFilters(params: Record<string, Param>, defaults: FeedDefaults = CENTRAL_DEFAULTS, now: Date = new Date()): FeedFilters {
  const kindList = (first(params.kinds) ?? "")
    .split(",")
    .filter((k): k is FeedKind => (FEED_KINDS as readonly string[]).includes(k));
  const allTime = defaults.rangeFilter === true && first(params.days) === "all";
  const days = Number(first(params.days));
  const actor = first(params.actor);
  const member = first(params.member);
  const parsedRange = defaults.rangeFilter ? parseDayRange(params.from, params.to, now) : null;

  return {
    view: parseView(first(params.view), defaults.view),
    kinds: kindList.length > 0 ? kindList : null,
    actorUserId: actor && UUID_RE.test(actor) ? actor : null,
    memberId: isId(member, "mbr") ? member : null,
    sudoOnly: first(params.sudo) === "1",
    hideSystem: first(params.nosystem) === "1",
    hideSlack: first(params.noslack) === "1",
    days: allTime ? ALL_TIME_DAYS : (FEED_DAY_OPTIONS as readonly number[]).includes(days) ? days : defaults.days,
    ...(parsedRange ? { range: parsedRange.range, rangeNotice: parsedRange.notice } : {}),
  };
}

/**
 * Query string for a filter set, omitting defaults. Page is deliberately not
 * included: changing a filter starts again on page 1.
 */
export function feedSearch(filters: Partial<FeedFilters>, defaults: FeedDefaults = CENTRAL_DEFAULTS): string {
  const q = new URLSearchParams();
  if (filters.view && filters.view !== defaults.view) q.set("view", filters.view);
  if (filters.kinds?.length) q.set("kinds", filters.kinds.join(","));
  if (filters.actorUserId) q.set("actor", filters.actorUserId);
  if (filters.memberId) q.set("member", filters.memberId);
  if (filters.sudoOnly) q.set("sudo", "1");
  if (filters.hideSystem) q.set("nosystem", "1");
  if (filters.hideSlack) q.set("noslack", "1");
  if (defaults.rangeFilter && filters.range) {
    q.set("from", filters.range.from);
    q.set("to", filters.range.to);
  } else if (defaults.rangeFilter && filters.days === ALL_TIME_DAYS) {
    q.set("days", "all");
  } else if (filters.days && filters.days !== defaults.days) {
    q.set("days", String(filters.days));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

/**
 * What a community manager's Activity tab asks for: one member's own activity (the `activity` kind) and nothing else, whatever the
 * URL says. The database enforces the same limit for her (get_activity_feed and count_activity_feed, migration
 * 20270817000000); this keeps what the page asks for, and what its filter bar offers, inside it too.
 */
export function limitedFeedFilters(filters: FeedFilters): FeedFilters {
  return { ...filters, view: "all", kinds: null, actorUserId: null };
}

/**
 * The instants a feed covers, [from, to): a custom range is its Eastern days (from 00:00 of the first to 00:00 after the
 * last, whole days whatever a daylight saving day's length); all time starts at the range floor; otherwise the last `days`
 * days up to a minute past now.
 */
export function feedWindow(filters: Pick<FeedFilters, "days" | "range">, now: Date): { from: Date; to: Date } {
  if (filters.range) return rangeInstants(filters.range);
  const to = new Date(now.getTime() + 60_000);
  if (filters.days === ALL_TIME_DAYS) return { from: allTimeStart(), to };
  return { from: new Date(now.getTime() - filters.days * 24 * 60 * 60 * 1000), to };
}

/**
 * The window and the total in plain words: "12 events, 3 Nov to 17 Nov", "1 event, last 90 days", "40 events, all time".
 */
export function describeFeedWindow(filters: Pick<FeedFilters, "days" | "range">, total: number, now: Date): string {
  const count = `${total.toLocaleString("en-US")} ${total === 1 ? "event" : "events"}`;
  if (filters.range) return `${count}, ${describeRange(filters.range, now)}`;
  if (filters.days === ALL_TIME_DAYS) return `${count}, all time`;
  return `${count}, ${filters.days === 1 ? "last 24 hours" : `last ${filters.days} days`}`;
}

function rpcArgs(filters: FeedFilters, now: Date, memberActivityOnly = false) {
  const { from, to } = feedWindow(filters, now);
  return {
    p_audit_only: !memberActivityOnly && filters.view === "audit",
    p_kinds: memberActivityOnly ? ["activity"] : filters.kinds,
    p_entity_types: !memberActivityOnly && filters.view === "privacy" ? [...PRIVACY_ENTITY_TYPES] : null,
    p_actor_user_id: memberActivityOnly ? null : filters.actorUserId,
    p_member_id: filters.memberId,
    p_sudo_only: filters.sudoOnly,
    p_hide_system: filters.hideSystem,
    p_hide_slack: filters.hideSlack,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  };
}

export interface FeedPage {
  rows: ActivityFeedRow[];
  total: number;
  /** The page actually served, clamped to what exists. */
  page: number;
  pageSize: number;
}

export async function fetchActivityFeed(
  supabase: SupabaseClient,
  query: FeedQuery,
  now: Date = new Date(),
  /** A community manager's tab: only the member's `activity` rows are asked for (see `limitedFeedFilters`). */
  options: { memberActivityOnly?: boolean } = {}
): Promise<FeedPage> {
  const args = rpcArgs(query, now, options.memberActivityOnly);
  const { data: count, error: countError } = await supabase.rpc("count_activity_feed", args);
  throwIfDbError("activity feed: count_activity_feed", countError);
  const total = (count as number | null) ?? 0;

  const bounds = pageBounds(query.page, query.pageSize, total);
  if (total === 0) return { rows: [], total, page: bounds.page, pageSize: bounds.pageSize };

  const { data, error } = await supabase.rpc("get_activity_feed", {
    ...args,
    p_offset: bounds.offset,
    p_limit: bounds.pageSize,
  });
  throwIfDbError("activity feed: get_activity_feed", error);
  return { rows: await withCarePlanNumbers(supabase, await withReferenceNames(supabase, await withMemberDisplayNames(supabase, await withMentionNames((data ?? []) as ActivityFeedRow[])))), total, page: bounds.page, pageSize: bounds.pageSize };
}

/**
 * The SQL function names members by legal name. Admins know them by display name too, so swap it in
 * for the member, the member an admin was viewing as, and an actor's label when it is a member's legal
 * name: a member actor, or a staff actor, who is labelled by their own member record (found through
 * their auth user id) and otherwise by their account email, which stays as it is.
 */
export async function withMemberDisplayNames(supabase: SupabaseClient, rows: ActivityFeedRow[]): Promise<ActivityFeedRow[]> {
  const repos = createRepos(supabase);
  const actorUserIds = [...new Set(rows.map((r) => r.actor_user_id).filter((id): id is string => !!id))];
  const memberIdByUserId = actorUserIds.length > 0 ? await repos.members.idsByUserId(actorUserIds) : new Map<string, string>();
  const ids = [...new Set([...rows.flatMap((r) => [r.member_id, r.acting_as_member_id]), ...memberIdByUserId.values()].filter((id): id is string => !!id))];
  if (ids.length === 0) return rows;
  const members = new Map<string, { legal: string; shown: string }>();
  for (const m of await repos.members.byIds(ids)) members.set(m.id, { legal: m.name, shown: getMemberDisplayName({ name: m.name, display_name: m.displayName }) });
  return rows.map((r) => {
    const member = r.member_id ? members.get(r.member_id) : undefined;
    const actingAs = r.acting_as_member_id ? members.get(r.acting_as_member_id) : undefined;
    const staffMember = r.actor_user_id ? members.get(memberIdByUserId.get(r.actor_user_id) ?? "") : undefined;
    const actor =
      r.actor_kind === "member" && member && r.actor_label === r.member_name
        ? member.shown
        : staffMember && r.actor_label === staffMember.legal
          ? staffMember.shown
          : r.actor_label;
    return {
      ...r,
      member_name: member?.shown ?? r.member_name,
      acting_as_member_name: actingAs?.shown ?? r.acting_as_member_name,
      actor_label: actor,
    };
  });
}

/** What else counts as part of one record's history, beyond rows about the record itself. */
export interface HistoryScope {
  /** Also rows of the same entity types whose delta names the record in this column (`event_id` on an event's attendees). */
  parentColumn?: string;
  /** Also every audit row about the member (`audit_log.member_id`), of any entity type. */
  memberRows?: boolean;
}

/**
 * Audited changes, newest first (get_record_history(): admin-only, capped at `limit`): to one
 * record when `entityId` is given (plus its children / a member's rows per `scope`), else to every
 * record of `entityTypes`. Types are the audit vocabulary ("member", "event", "badge_type"...), the
 * id the record's key as text.
 */
export async function fetchRecordHistory(
  supabase: SupabaseClient,
  entityTypes: string[],
  entityId: string | null = null,
  scope: HistoryScope = {},
  limit = 200
): Promise<ActivityFeedRow[]> {
  const { data, error } = await supabase.rpc("get_record_history", {
    p_entity_types: entityTypes,
    p_entity_id: entityId,
    p_limit: limit,
    p_parent_column: scope.parentColumn ?? null,
    p_member_rows: scope.memberRows ?? false,
  });
  throwIfDbError("record history: get_record_history", error);
  return withCarePlanNumbers(supabase, await withReferenceNames(supabase, await withMemberDisplayNames(supabase, await withMentionNames((data ?? []) as ActivityFeedRow[]))));
}

/**
 * "Renewed the care plan (second plan)": a renewal's audit row says which plan it continues, not how many came before, so count
 * along the member's chain (`renewed_from`). One read of the member's plans per renewal row on the page; a plan that was removed
 * ends the count there, as on the plan card.
 */
export async function withCarePlanNumbers(supabase: SupabaseClient, rows: ActivityFeedRow[]): Promise<ActivityFeedRow[]> {
  const renewals = rows.filter((r) => r.kind === "audit" && r.entity_type === "care_engagement" && r.event_type === "insert" && r.member_id && r.entity_id && changedFields(r.data).some(([k, v]) => k === "renewed_from" && v.new));
  if (renewals.length === 0) return rows;
  const care = createRepos(supabase).care;
  const memberIds = [...new Set(renewals.map((r) => r.member_id as string))];
  const chains = new Map<string, Map<string, { renewed_from: string | null }>>();
  await Promise.all(
    memberIds.map(async (memberId) => {
      chains.set(memberId, new Map((await care.forMember(memberId)).map((plan) => [plan.id, plan])));
    })
  );
  return rows.map((r) => {
    if (!renewals.includes(r)) return r;
    const byId = chains.get(r.member_id as string);
    const renewedFrom = changedFields(r.data).find(([k]) => k === "renewed_from")?.[1].new;
    if (!byId || typeof renewedFrom !== "string") return r;
    // A renewal is at least the second; a chain that ends at a plan that is gone says nothing rather than "first".
    const number = periodNumber({ id: r.entity_id as string, renewed_from: renewedFrom }, byId);
    return number >= 2 ? { ...r, planNumber: number } : r;
  });
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

/** What reactionName reads: a member's Slack tab row (activity_type) or an activity log row (event_type). */
export interface ReactionRow {
  activity_type?: string | null;
  event_type?: string | null;
  title?: string | null;
  /** Activity data: an object for reactions, though the column's type is any JSON value. */
  data?: unknown;
}

/** The emoji name (no colons) of a Slack reaction row, else null. */
/** The row's data when it is an object (arrays and scalars are not activity data). */
export function dataObject(data: unknown): Record<string, unknown> | null {
  return data !== null && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
}

const RESEND_EMAIL_URL = /^https:\/\/resend\.com\/emails\/[A-Za-z0-9_-]+$/;

/**
 * Where an email activity's email can be read at Resend (`data.resend_url`, written by src/lib/email-events.ts), or null.
 * Only a resend.com email address is ever returned, so a link in stored data can't send an admin elsewhere.
 */
export function emailLinkOf(data: ActivityFeedRow["data"]): string | null {
  const url = data?.resend_url;
  return typeof url === "string" && RESEND_EMAIL_URL.test(url) ? url : null;
}

export function reactionName(row: ReactionRow): string | null {
  if ((row.activity_type ?? row.event_type) !== "slack_reaction") return null;
  const fromData = dataObject(row.data)?.reaction;
  if (typeof fromData === "string" && fromData) return fromData;
  return row.title?.match(/:([^:\s]+(?:::skin-tone-\d)?):/)?.[1] ?? null;
}

const humanize = (s: string) => s.replace(/_/g, " ");

interface FieldChange {
  old: unknown;
  new: unknown;
}

/** Fields of an audit row's `changes` delta, in key order. */
export function changedFields(data: ActivityFeedRow["data"]): Array<[string, FieldChange]> {
  return Object.entries((data ?? {}) as Record<string, FieldChange>).filter(
    ([, v]) => v && typeof v === "object" && "old" in v && "new" in v
  );
}

export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v.length > 80 ? `${v.slice(0, 77)}…` : v;
  const json = JSON.stringify(v);
  return json.length > 80 ? `${json.slice(0, 77)}…` : json;
}

const ACTION_VERBS: Record<string, string> = {
  insert: "added",
  update: "changed",
  delete: "removed",
};

/** "Bramble Admin (as Fern Quillsby)" when an admin acted in sudo. */
export function actorDisplay(row: ActivityFeedRow): string {
  const name = actorName(row);
  return row.acting_as_member_name ? `${name} (as ${row.acting_as_member_name})` : name;
}

export function actorName(row: ActivityFeedRow): string {
  if (row.actor_kind === "system") return "System";
  return row.actor_label ?? (row.actor_kind === "staff" ? "A staff member" : "A member");
}

/** What member-authored entity types are called in a sentence; others fall back to the humanized type. */
const ENTITY_LABELS: Record<string, string> = {
  writing_project: "writing project",
  writing_goal: "writing goal",
  writing_starting_balance: "starting balance",
  writing_progress_entry: "writing progress entry",
  member_book: "book",
  member_award: "award",
  member_badge: "badge",
  prickle_commitment: "prickle commitment",
  quiz: "quiz",
  calendar_feed: "calendar link",
  calendar_feed_item: "calendar item",
  wheel_of_wonder_match: "Wheel of Wonder match",
  member_ask_me_about: "“Ask me about” topics",
  member_profile_visibility: "who can see their profile",
  restricted_slack_channel: "restricted Slack channel",
  care_dm_read: "read of a member's care plan messages",
  segment_member: "segment membership",
  user_role: "role",
  feature_flag: "feature",
  feature_flag_segment: "feature flag segment",
  user_feature_preview: "feature preview",
  event_attendee: "event attendee",
  program_enrollment: "program enrollment",
  member_status_override: "status override",
  prickle_host_vibe: "host vibe",
  mentorship: "Big Sister match",
  care_engagement: "care plan",
  landing_page: "page",
  landing_page_template: "template",
  landing_site_template: "site design",
  member_milestone: "milestone",
  writer_profile: "public writer profile",
};

const NAME_FIELDS = ["title", "name", "alias"] as const;

/** The record's own name (a project's title, an alias...), when its delta carries one. */
function recordName(row: ActivityFeedRow): string | null {
  // The trigger stores the record's name on the row (description), which UPDATE deltas can't carry.
  if (row.description) return formatValue(row.description);
  const fields = Object.fromEntries(changedFields(row.data));
  for (const key of NAME_FIELDS) {
    const change = fields[key];
    const value = change && (row.event_type === "delete" ? change.old : change.new);
    if (typeof value === "string" && value) return formatValue(value);
  }
  return null;
}

/** A feature's name as staff know it ("Chat", "Send prickle reminders"), else its key with the underscores out. */
function featureName(key: string): string {
  return `“${FEATURE_PREVIEWS.find((f) => f.key === key)?.name ?? key.replace(/_/g, " ")}”`;
}

/**
 * Feature switches in plain words (the trigger labels them with the feature key, and a segment link with "key · segment").
 * A flag flip is "turned “Chat” on for everyone", a segment link says which segment got the feature, and a member's own
 * preview is "turned on the “Chat” preview".
 */
function featurePhrase(row: ActivityFeedRow, fields: Record<string, { old: unknown; new: unknown }>): string | null {
  const label = row.description ?? row.entity_id ?? "";
  if (row.entity_type === "feature_flag") {
    const feature = featureName(label);
    if (row.event_type === "insert") return `added the ${feature} feature${fields.enabled_globally?.new === true ? ", on for everyone" : ""}`;
    if (row.event_type === "delete") return `removed the ${feature} feature`;
    if (fields.enabled_globally) return `turned ${feature} ${fields.enabled_globally.new ? "on" : "off"} for everyone`;
    return null;
  }
  if (row.entity_type === "feature_flag_segment") {
    const [key, segment] = label.split(" · ");
    const feature = featureName(key);
    const who = segment ? `the “${segment}” segment` : "a segment";
    if (row.event_type === "insert") return `gave ${who} the ${feature} feature`;
    if (row.event_type === "delete") return `took the ${feature} feature away from ${who}`;
    return null;
  }
  if (row.entity_type === "user_feature_preview") {
    if (row.event_type === "insert") return `turned on the ${featureName(label)} preview`;
    if (row.event_type === "delete") return `turned off the ${featureName(label)} preview`;
  }
  return null;
}

/**
 * The page builder's pages and templates in plain words (docs/product/LANDING_PAGES.md). A page is named by its title and a template by
 * its name (the trigger puts it on the row as the description); never page content, a template's typed description or note, or a
 * page's search text, which the audit columns redact and these sentences don't read.
 */
function pageBuilderPhrase(row: ActivityFeedRow, fields: Record<string, FieldChange>): string | null {
  const name = recordName(row);
  const quoted = name ? ` “${name}”` : "";
  const text = (change: FieldChange | undefined) => (typeof change?.old === "string" && change.old ? ` “${formatValue(change.old)}”` : "");
  // The header and footer shared by every website page: publishing, bringing a version back and throwing the draft away are entries
  // (the draft is autosaved, so typing is not), never the content.
  if (row.entity_type === "landing_site_template") {
    if (row.event_type !== "update" && row.event_type !== "insert") return null;
    if (fields.published_at?.new) return "published the site design (the header and footer shared by every website page)";
    if (fields.restored_at?.new) return "brought back an earlier version of the site design into its draft";
    if (fields.draft_reset_at?.new) return "threw away the draft of the site design and went back to the published one";
    return null;
  }
  const isTemplate = row.entity_type === "landing_page_template";
  if (row.entity_type === "landing_page" || isTemplate) {
    const noun = isTemplate ? "template" : "page";
    if (row.event_type === "insert") return fields.replaced_at?.new ? `created the ${noun}${quoted} from a JSON file` : `created the ${noun}${quoted}`;
    if (row.event_type === "delete") return `deleted the ${noun}${quoted}`;
    if (row.event_type !== "update") return null;
    if (fields.deleted_at?.new && !fields.deleted_at.old) return `deleted the ${noun}${quoted}`;
    if (fields.status?.new === "published" || (fields.published_at?.new && fields.status?.new !== "draft")) return `published the ${noun}${quoted}`;
    if (fields.status?.new === "draft") return `took the ${noun}${quoted} down`;
    if (fields.restored_at?.new) return `brought back an earlier version of the ${noun}${quoted} into its draft`;
    // `starter_applied_at` is the old name of `replaced_at` (the column is gone): old Activity Log rows still carry it.
    if (fields.replaced_at?.new || fields.starter_applied_at?.new) return `replaced the draft of the ${noun}${quoted} with a template or an imported file`;
    if (fields.imported_at?.new) return `imported a Kajabi page into the draft of${quoted || " a page"}`;
    if (fields.title) return `renamed the ${noun}${text(fields.title)} to “${formatValue(fields.title.new)}”`;
    if (fields.slug) return `changed the address of the ${noun}${quoted}`;
    if (fields.seo_title || fields.seo_description || fields.social_image_asset_id) return `changed the search and sharing details of the ${noun}${quoted}`;
    return null;
  }
  return null;
}

/** Phrases for events that read better than "changed calendar link — first fetched at". */
/**
 * A member's public writer profile (docs/product/WRITER_PROFILES.md): the switch, and which settings changed. Never the bio (the trigger
 * redacts it) and never the address (its changes are recorded as the member's own activity, "Changed the address of ...").
 */
function writerProfilePhrase(row: ActivityFeedRow, fields: Record<string, { old: unknown; new: unknown } | undefined>): string | null {
  if (row.entity_type !== "writer_profile" || row.event_type !== "update") return null;
  if (fields.is_public) return fields.is_public.new ? "turned on their public writer profile" : "turned off their public writer profile";
  const changed = [
    fields.public_name_alias_id && "the name shown",
    // Audit entries written before the column was dropped keep their field name; the Activity Log still reads them.
    fields.show_photo && "whether their photo is shown",
    fields.public_bio && "the bio",
  ].filter(Boolean);
  return changed.length > 0 ? `changed ${changed.join(" and ")} on their public writer profile` : null;
}

/**
 * The Finisher record in plain words (docs/product/FINISHERS.md). A proposal names the milestone; an answer says what the member
 * did without repeating the dates or stories they wrote (the trigger redacts the stories, and nothing here reads them).
 */
function milestonePhrase(row: ActivityFeedRow, fields: Record<string, FieldChange>): string | null {
  if (row.entity_type !== "member_milestone") return null;
  if (row.event_type === "insert") {
    const kind = typeof fields.kind?.new === "string" ? milestoneLabel(fields.kind.new) : "a writing";
    // A member adds their own already confirmed (source member); staff and courses only propose.
    if (fields.source?.new === "member") return `added the “${kind}” milestone`;
    // Answering the question asked when a project moved forward (docs/product/FINISHERS.md): "yes" is confirmed, "not yet" is declined.
    if (fields.source?.new === "project_stage") {
      return fields.status?.new === "declined" ? `said “not yet” to the “${kind}” milestone when a project moved forward` : `added the “${kind}” milestone when a project moved forward`;
    }
    return `proposed the “${kind}” milestone for ${row.member_name ?? "a member"}`;
  }
  if (row.event_type !== "update") return null;
  if (fields.deleted_at?.new && !fields.deleted_at.old && row.actor_kind === "member") return "took back a milestone they added";
  if (fields.deleted_at?.new && !fields.deleted_at.old) return `took back a proposed milestone for ${row.member_name ?? "a member"}`;
  if (fields.status?.new === "confirmed") return "confirmed a writing milestone";
  if (fields.status?.new === "declined") return "said a proposed writing milestone is not theirs, or not yet";
  if (typeof fields.visibility?.new === "string") {
    if (fields.visibility.new === "private") return "made a writing milestone private";
    if (fields.visibility.new === "public") return "showed a writing milestone on their public writer profile";
    return "showed a writing milestone to other members";
  }
  if (fields.consent_testimonial) {
    return fields.consent_testimonial.new === true ? "said we may feature the story of a writing milestone" : "took back permission to feature the story of a writing milestone";
  }
  // The trigger redacts the path and the description, so the log can say only that a photo changed (added, replaced or removed), never where it is or what it shows.
  if (fields.photo_path) return "changed the photo on a writing milestone";
  if (fields.photo_alt) return "changed what the photo on a writing milestone shows";
  return null;
}

/** The items of a member's profile whose level changed, by name; the levels' own words are not repeated (the log keeps old and new). */
const PROFILE_LEVEL_FIELDS: Record<string, string> = {
  bio_visibility: "bio",
  photo_visibility: "photo",
  instagram_visibility: "Instagram link",
  facebook_visibility: "Facebook link",
  twitter_visibility: "X link",
};

/** Who can see a member's profile items (docs/product/WRITER_PROFILES.md): which items changed, never what they hold (the trigger redacts the text). */
function profileVisibilityPhrase(row: ActivityFeedRow, fields: Record<string, { old: unknown; new: unknown } | undefined>): string | null {
  if (row.entity_type === "member_ask_me_about" && fields.visibility && row.event_type === "update") return "changed who can see their “Ask me about” topics";
  if (row.entity_type !== "member_profile_visibility") return null;
  const items = Object.keys(PROFILE_LEVEL_FIELDS).filter((key) => fields[key]).map((key) => PROFILE_LEVEL_FIELDS[key]);
  if (items.length === 0) return null;
  return `changed who can see their ${items.length === 1 ? items[0] : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`}`;
}

/**
 * A person given or losing a staff role ("gave ada@example.com the role Community Manager"). The label is the account's sign-in
 * email and the role one of the fixed names; nothing a person typed. A person can hold several roles, each its own entry.
 */
function userRolePhrase(row: ActivityFeedRow, fields: Record<string, { old: unknown; new: unknown }>): string | null {
  if (row.entity_type !== "user_role" || row.event_type === "update") return null;
  const raw = row.event_type === "insert" ? fields.role?.new : fields.role?.old;
  const role = typeof raw === "string" && isStaffRole(raw) ? ROLE_LABELS[raw] : "a role";
  const who = row.description ? formatValue(row.description) : "a user";
  return row.event_type === "insert" ? `gave ${who} the role ${role}` : `took the role ${role} away from ${who}`;
}

function specialAuditPhrase(row: ActivityFeedRow): string | null {
  const fields = Object.fromEntries(changedFields(row.data));
  const profileVisibility = profileVisibilityPhrase(row, fields);
  if (profileVisibility) return profileVisibility;
  const feature = featurePhrase(row, fields);
  if (feature) return feature;
  const pageBuilder = pageBuilderPhrase(row, fields);
  if (pageBuilder) return pageBuilder;
  const writerProfile = writerProfilePhrase(row, fields);
  if (writerProfile) return writerProfile;
  const milestone = milestonePhrase(row, fields);
  if (milestone) return milestone;
  const userRole = userRolePhrase(row, fields);
  if (userRole) return userRole;
  if (row.entity_type === "event_attendee" && row.event_type !== "update") {
    const who = row.member_name ?? "a member";
    const event = row.description ? ` “${formatValue(row.description)}”` : "";
    return row.event_type === "insert" ? `added ${who} as an attendee of${event || " an event"}` : `removed ${who} as an attendee of${event || " an event"}`;
  }
  if (row.entity_type === "calendar_feed") {
    if (row.event_type === "insert") return "created their calendar link";
    if (fields.first_fetched_at && fields.first_fetched_at.new) return "added their calendar link to a calendar app";
    if (fields.token) return "generated a new calendar link";
  }
  if (row.entity_type === "wheel_of_wonder_match" && row.event_type === "insert") return "spun the Wheel of Wonder";
  // One entry per reorder of a course's modules or a module's lessons (the migration says why not one per row).
  if (row.entity_type === "course_lesson_order" || row.entity_type === "course_module_order") {
    const order = fields.order?.new;
    const count = Array.isArray(order) ? ` ${order.length}` : "";
    const what = row.entity_type === "course_lesson_order" ? "lessons" : "modules";
    return `reordered the${count} ${what}${row.description ? ` in “${formatValue(row.description)}”` : ""}`;
  }
  // A member's reorder of the goals in a project is one entry for the list (20270811000000).
  if (row.entity_type === "writing_goal_order") {
    const order = fields.order?.new;
    return Array.isArray(order) ? `reordered the ${order.length} goal${order.length === 1 ? "" : "s"} in a writing project` : "reordered the goals in a writing project";
  }
  // A member's reorder of their writing projects is one entry for the list (20270808000000).
  if (row.entity_type === "writing_project_order") {
    const order = fields.order?.new;
    return Array.isArray(order) ? `reordered their ${order.length} writing project${order.length === 1 ? "" : "s"}` : "reordered their writing projects";
  }
  // Staff moderation of a lesson comment is one entry with the lesson's title and what changed, never the comment's text (the migration says why).
  if (row.entity_type === "lesson_comment" && row.event_type === "update") {
    const lesson = row.description ? ` on “${formatValue(row.description)}”` : "";
    const settled = fields.reports_resolved ? ", settling its reports" : "";
    const before = fields.visibility?.old;
    const after = fields.visibility?.new;
    if (after === "hidden") return `hid a comment${lesson}${settled}`;
    if (after === "deleted") return `deleted a comment${lesson}${settled}`;
    if (before === "held" && after === "visible") return `approved a held comment${lesson}`;
    if (before === "hidden") return `showed a hidden comment again${lesson}`;
    if (fields.handled?.new) return `marked a question as handled${lesson}`;
    if (fields.reports_resolved) return `dismissed the reports on a comment${lesson}`;
  }
  // An admin or community manager opened a member's Hedgie Care plan messages (the member is the row's subject). Only the fact is recorded, never the text.
  if (row.entity_type === "care_dm_read") return "opened a member's Hedgie Care plan messages (the messages are not recorded)";
  // A course made by duplicating another is one entry with where it came from and what it holds (the migration says why not one per row).
  if (row.entity_type === "course" && row.event_type === "insert" && fields.copied_from?.new) {
    const lessons = Number(fields.lessons_copied?.new);
    const count = Number.isFinite(lessons) ? ` (${lessons} ${lessons === 1 ? "lesson" : "lessons"})` : "";
    return `duplicated a course as “${formatValue(row.description ?? "")}”${count}`;
  }
  // A deleted course is one entry with what went with it (`delete_course` writes the counts; the modules' and lessons' own entries are quiet).
  if (row.entity_type === "course" && row.event_type === "delete") {
    const lessons = Number(fields.lessons_deleted?.old);
    const modules = Number(fields.modules_deleted?.old);
    const holds = [Number.isFinite(modules) && `${modules} ${modules === 1 ? "module" : "modules"}`, Number.isFinite(lessons) && `${lessons} ${lessons === 1 ? "lesson" : "lessons"}`].filter(Boolean).join(", ");
    return `deleted a course${row.description ? ` “${formatValue(row.description)}”` : ""}${holds ? ` (${holds})` : ""}`;
  }
  // A quiz is named by its lesson. Editing its questions is one entry on the quiz (its revision moves), never the question text.
  if (row.entity_type === "quiz") {
    const lesson = row.description ? ` “${formatValue(row.description)}”` : "";
    if (row.event_type === "insert") return `made the lesson${lesson || ""} a quiz`;
    if (row.event_type === "delete") return `turned the quiz${lesson ? ` “${formatValue(row.description ?? "")}”` : ""} back into a plain lesson`;
    const settings = Boolean(fields.passing_percent || fields.hide_answers);
    const questions = Boolean(fields.revision);
    const where = row.description ? ` in “${formatValue(row.description)}”` : "";
    if (settings && questions) return `changed the settings and questions of the quiz${where}`;
    if (settings) return `changed the settings of the quiz${where}`;
    if (questions) return `edited the questions of the quiz${where}`;
  }
  if (row.entity_type === "restricted_slack_channel") {
    const channel = row.description ? `#${formatValue(row.description)}` : "a Slack channel";
    if (row.event_type === "insert") return `restricted staff access to messages in ${channel}`;
    if (row.event_type === "delete") return `lifted the restriction on messages in ${channel}`;
  }

  // A care plan's changes read as what the person did (src/lib/care-events.ts); never the typed fields, which the trigger redacts.
  const care = careEventOfAudit({ entity_type: row.entity_type, event_type: row.event_type, actor_user_id: row.actor_user_id, fields, refs: row.refs, planNumber: row.planNumber });
  if (care) return careSentence(care.kind, care.context);

  const name = recordName(row);
  const quoted = name ? ` “${name}”` : "";
  // Members' deletes are soft: the row stays and `deleted_at` is set (or cleared, if restored).
  if (row.event_type === "update" && fields.deleted_at) {
    const deleted = !fields.deleted_at.old && !!fields.deleted_at.new;
    const restored = !!fields.deleted_at.old && !fields.deleted_at.new;
    if (deleted || restored) {
      if (row.entity_type === "member_book") return deleted ? `removed${quoted} from their bookshelf` : `put${quoted} back on their bookshelf`;
      const entity = ENTITY_LABELS[row.entity_type ?? ""] ?? humanize(row.entity_type ?? "record");
      return `${deleted ? "deleted" : "restored"} ${entity}${quoted}`;
    }
  }
  if (row.entity_type === "writing_project" && fields.phase && row.event_type === "update") {
    return `moved writing project${quoted} from ${humanize(String(fields.phase.old))} to ${humanize(String(fields.phase.new))}`;
  }
  if (row.entity_type === "member_book") {
    // A book with a project_id came from "Publish" on a project; without one it was added directly.
    if (row.event_type === "insert") {
      return fields.project_id?.new ? `published${quoted} from a writing project` : `added${quoted} to their bookshelf`;
    }
    if (row.event_type === "delete") return `removed${quoted} from their bookshelf`;
    // Who may see the book (the lock, house or globe on My Books): the level in words, never the book's description.
    if (row.event_type === "update" && typeof fields.visibility?.new === "string") {
      if (fields.visibility.new === "private") return `made${quoted} private: only they can see it`;
      if (fields.visibility.new === "public") return `showed${quoted} on the public Hedgie Bookshelf`;
      return `showed${quoted} to other members only`;
    }
  }
  return null;
}

const titleCase = (s: string) => s.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** "/prickles/<id>" -> "Prickles · one", "/my-prickles/all" -> "My Prickles · All": paths read as places. */
export function pageLabel(path: string): string {
  const segments = path.split("?")[0].split("/").filter(Boolean);
  if (segments.length === 0) return "Home";
  const [first, second] = segments;
  const section = titleCase(first);
  if (!second) return section;
  return isAnyId(second) ? `${section} · one` : `${section} · ${titleCase(second)}`;
}

export interface PageCount {
  label: string;
  count: number;
}

/** A visit's page trail as counts per place, most-visited first: 246 raw paths become a dozen lines. */
export function summarizePages(pages: string[]): PageCount[] {
  const counts = new Map<string, number>();
  for (const path of pages) {
    const label = pageLabel(path);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

/** One-line summary of what happened, e.g. "changed member — status". */
export function describeRow(row: ActivityFeedRow): string {
  if (row.kind === "audit") {
    const special = specialAuditPhrase(row);
    if (special) return special;
    const verb = ACTION_VERBS[row.event_type] ?? row.event_type;
    const entity = ENTITY_LABELS[row.entity_type ?? ""] ?? humanize(row.entity_type ?? "record");
    const name = recordName(row);
    const fields = changedFields(row.data).map(([k]) => humanize(k));
    const suffix =
      row.event_type === "update" && fields.length > 0
        ? ` — ${fields.slice(0, 4).join(", ")}${fields.length > 4 ? `, +${fields.length - 4} more` : ""}`
        : "";
    return `${verb} ${entity}${name ? ` “${name}”` : ""}${suffix}`;
  }
  if (row.kind === "note") return "added a note";
  if (row.kind === "session") {
    const pages = Array.isArray(row.data?.pages) ? (row.data.pages as string[]) : [];
    if (pages.length === 0) return "was active (no page views)";
    const top = summarizePages(pages)
      .slice(0, 3)
      .map((p) => `${p.label} ×${p.count}`)
      .join(", ");
    return `visited ${pages.length} page${pages.length === 1 ? "" : "s"}${pages.length > 1 ? ` (${top})` : ""}`;
  }
  // A care plan's own rows on the member's timeline (the plan card's activity list); the central log gets these events from the audit rows.
  if (row.source === "care") {
    const care = careActivitySentence({ activity_type: row.event_type, data: row.data, description: row.description });
    if (care) return care;
  }
  const base = row.title ?? humanize(row.event_type);
  // Check-ins and check-outs say where they happened: "(via Slack)" vs "(via web)".
  const via = row.data?.via;
  return typeof via === "string" ? `${base} (via ${via === "slack" ? "Slack" : via})` : base;
}
