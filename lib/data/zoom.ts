import { chunk, fetchAllRows } from "@/lib/supabase/paginate";
import { upsertInChunks } from "./query";
import type { Database } from "./database.types";
import type { Db } from "./db";
import type { InMemoryDataset } from "./in-memory";
import {
  buildKeepPolicy,
  isMeetingKept,
  PRIMARY_ZOOM_ACCOUNT_ID,
  meetingState,
  type ZoomDecision,
  type ZoomDecisionRef,
  type ZoomDecisionScope,
  type ZoomDefaultPolicy,
  type ZoomKeepPolicy,
  type ZoomMeetingState,
} from "@/lib/zoom-accounts";

/** One row of Zoom's participant report as the Bronze import keeps it (`bronze.zoom_attendees`). */
export type ZoomAttendeeRow = Database["bronze"]["Tables"]["zoom_attendees"]["Row"];
export type NewZoomAttendee = Database["bronze"]["Tables"]["zoom_attendees"]["Insert"];
/** A meeting as the Bronze import keeps it (`bronze.zoom_meetings`). */
export type ZoomMeetingRow = Database["bronze"]["Tables"]["zoom_meetings"]["Row"];
export type NewZoomMeeting = Database["bronze"]["Tables"]["zoom_meetings"]["Insert"];
/** A Zoom account the Hub imports from (`zoom_accounts`) and an admin's keep/ignore decision about its meetings (`zoom_meeting_decisions`). */
export type ZoomAccountRow = Database["public"]["Tables"]["zoom_accounts"]["Row"];
export type ZoomDecisionRow = Database["public"]["Tables"]["zoom_meeting_decisions"]["Row"];
export interface ZoomAccount {
  id: string;
  slug: string;
  label: string;
  hostEmail: string | null;
  defaultPolicy: ZoomDefaultPolicy;
  /** Environment variable prefix of the account's credentials (`<prefix>_ACCOUNT_ID`, ...). */
  credentialsPrefix: string;
}
/** A meeting listed for review, with what applies to it now. */
export interface ZoomReviewMeeting {
  zoomAccount: string;
  meetingUuid: string;
  meetingId: string;
  topic: string;
  startTime: string;
  endTime: string | null;
  hostEmail: string | null;
  participantCount: number | null;
  /** `kept` and `ignored` are decisions; `undecided` means the account's default applies. */
  state: ZoomMeetingState;
}

/** The Bronze row types as seeds: a row with no `zoom_account` is the primary account's (the column's default). */
type WithOptionalAccount<T> = Omit<T, "zoom_account"> & { zoom_account?: string };
export interface ZoomSeeds {
  zoomAttendees: WithOptionalAccount<Database["bronze"]["Tables"]["zoom_attendees"]["Row"]>[];
  zoomMeetings: WithOptionalAccount<Database["bronze"]["Tables"]["zoom_meetings"]["Row"]>[];
  zoomParticipantEvents: WithOptionalAccount<Database["bronze"]["Tables"]["zoom_participant_events"]["Row"]>[];
  zoomChatMessages: WithOptionalAccount<Database["bronze"]["Tables"]["zoom_chat_messages"]["Row"]>[];
}

/** A Zoom name an admin ignores everywhere (`ignored_zoom_names`). */
export type IgnoredZoomNameRow = Database["public"]["Tables"]["ignored_zoom_names"]["Row"];

/** A join or leave seen live by the Zoom webhook (`bronze.zoom_participant_events`, service role only). */
export type ZoomParticipantEventRow = Database["bronze"]["Tables"]["zoom_participant_events"]["Row"];
export type NewZoomParticipantEvent = Database["bronze"]["Tables"]["zoom_participant_events"]["Insert"];
/** The columns presence reads of a participant event (the webhook only records "joined" and "left"). */
export type ZoomParticipantEvent = Pick<ZoomParticipantEventRow, "id" | "meeting_uuid" | "host_id" | "participant_key" | "participant_name" | "participant_email" | "event_time"> & {
  event: "joined" | "left";
};
/**
 * An in-meeting chat message the webhook saw (`bronze.zoom_chat_messages`, service role only: the text and the
 * raw payload are hidden from admins, who read `zoom_chat_messages_meta`: sender and, for a private message, recipient).
 */
export type ZoomChatMessageRow = Database["bronze"]["Tables"]["zoom_chat_messages"]["Row"];
export type NewZoomChatMessage = Database["bronze"]["Tables"]["zoom_chat_messages"]["Insert"];

/** A Zoom display name that matched several members, queued for an admin to decide (`ambiguous_zoom_names`). */
export type AmbiguousZoomNameRow = Database["public"]["Tables"]["ambiguous_zoom_names"]["Row"];
/** A Zoom name ignored for one prickle only (`ignored_zoom_appearances`). */
export type IgnoredZoomAppearanceRow = Database["public"]["Tables"]["ignored_zoom_appearances"]["Row"];

/** How to get into the prickle Zoom room from some moment on (`prickle_join_settings`, append-only). */
export type PrickleJoinSettingRow = Database["public"]["Tables"]["prickle_join_settings"]["Row"];
/** What an admin enters when the join link, meeting ID or passcode changes. */
export type NewPrickleJoinSetting = { joinUrl: string; meetingId: string | null; passcode: string | null; effectiveFrom: string; createdBy: string | null };

/** What name matching reads of an attendee row. */
export type ZoomAttendeeRef = Pick<ZoomAttendeeRow, "name" | "email" | "meeting_uuid" | "join_time" | "leave_time">;
/** One appearance of a name, with enough to say when and where. */
export type ZoomNameAppearance = Pick<ZoomAttendeeRow, "name" | "email" | "join_time" | "topic" | "meeting_uuid" | "meeting_id">;

const PAGE_CHUNK = 100;
const SESSION_CHUNK = 50;
const WRITE_CHUNK = 500;


/**
 * The Bronze copy of Zoom's attendance (`bronze.zoom_attendees`, `bronze.zoom_meetings`) and the
 * names admins ignore (`ignored_zoom_names`). The import upserts attendees on (meeting uuid, name,
 * join time) and meetings on their uuid, so a re-import never duplicates. `zoom_attendees` is large:
 * every read that can pass 1000 rows pages through a stable order and every id list is chunked.
 * Reads and writes throw on a database error.
 */
export interface ZoomRepository {
  // --- attendees ---
  /** How many attendee rows are stored (a person who rejoined has several). */
  attendeeCount(): Promise<number>;
  /**
   * Every attendee row, the columns name matching reads, in id order. `withMeetingOnly` leaves out
   * rows with no meeting uuid (the attendance run can't group them).
   */
  attendeesForMatching(options?: { withMeetingOnly?: boolean }): Promise<ZoomAttendeeRef[]>;
  /** Name, email and meeting uuid of the rows that joined at or after an instant, in id order. */
  attendeesSince(from: string): Promise<Pick<ZoomAttendeeRow, "name" | "email" | "meeting_uuid">[]>;
  /** Name and email of the rows whose stay overlaps a range (joined before its end, left after its start), in id order. */
  attendeeNamesOverlapping(from: string, to: string): Promise<Pick<ZoomAttendeeRow, "name" | "email">[]>;
  /** The full rows whose stay overlaps a range, by join time then id. */
  attendeesOverlapping(from: string, to: string): Promise<ZoomAttendeeRow[]>;
  /** Every appearance of these names, in id order. Chunked. */
  appearancesOf(names: string[]): Promise<ZoomNameAppearance[]>;
  /** For each of these names, in how many distinct meetings it appears (rows with no meeting uuid don't count). A name never seen is left out. */
  meetingCountsByName(names: string[]): Promise<Map<string, number>>;
  /** The distinct meeting uuids one name appears in (rows with no meeting uuid are left out). */
  meetingUuidsForName(name: string): Promise<string[]>;
  /**
   * Who was in these sessions, by session key (a meeting's uuid, or its id for rows with no uuid,
   * the key the attendance run groups by). Each row is listed once. Keys with nobody are left out.
   */
  attendeesInSessions(sessionKeys: string[]): Promise<Map<string, { name: string; email: string | null }[]>>;
  /**
   * Every attendee row of these sessions (the same key: a meeting's uuid, or its id for rows with no
   * uuid), whatever the time: a session is read whole, so a run that sees part of a meeting can
   * still compute its real start and end. Earliest join first.
   */
  attendeesOfSessions(sessionKeys: string[]): Promise<ZoomAttendeeRow[]>;
  /** Adds attendee rows, or updates the ones with the same (meeting uuid, name, join time). Written in chunks. */
  upsertAttendees(rows: NewZoomAttendee[]): Promise<void>;

  // --- meetings ---
  /** The start of the most recent imported meeting, or null when none is. */
  latestMeetingStart(): Promise<string | null>;
  /** Adds a meeting or updates the one with the same uuid. */
  upsertMeeting(meeting: NewZoomMeeting): Promise<void>;
  /** Zoom host ids of the meetings that started at or after an instant (the rooms the import covers). */
  importedHostIds(since: string): Promise<Set<string>>;

  // --- accounts and which of their meetings are kept ---
  /** Every account, oldest first. */
  accounts(): Promise<ZoomAccount[]>;
  /** Registers an account. Throws when the slug or credentials prefix is taken. */
  createAccount(input: { slug: string; label: string; hostEmail: string | null; defaultPolicy: ZoomDefaultPolicy; credentialsPrefix: string }): Promise<ZoomAccount>;
  /** What the keep/ignore rules read: the accounts' defaults and every decision. */
  keepPolicy(): Promise<ZoomKeepPolicy>;
  /** Keeps or ignores one meeting (`instance`, by uuid) or every occurrence of a link (`series`, by meeting id), replacing an earlier decision for the same key. */
  setDecision(input: { zoomAccount: string; scope: ZoomDecisionScope; zoomKey: string; decision: ZoomDecision; decidedBy: string | null }): Promise<void>;
  /** Takes a decision back: the meeting follows the next rule down (its link's, then the account's default). */
  clearDecision(input: { zoomAccount: string; scope: ZoomDecisionScope; zoomKey: string }): Promise<void>;
  /** The meetings of accounts whose default is to exclude them, newest first, each with its state. */
  reviewMeetings(): Promise<ZoomReviewMeeting[]>;
  /** How many of those meetings no one has decided about. */
  undecidedMeetingCount(): Promise<number>;
  /** The first start and last end of the meetings a decision covers (the range to reprocess), or null when there are none. */
  meetingSpan(input: { zoomAccount: string; scope: ZoomDecisionScope; zoomKey: string }): Promise<{ from: string; to: string } | null>;

  // --- ignored names ---
  /** Every Zoom name ignored everywhere. */
  ignoredNames(): Promise<string[]>;
  /** Ignores a name everywhere. Throws when it is already ignored. */
  ignoreName(input: { zoomName: string; reason: string | null; ignoredBy: string | null }): Promise<void>;
  /** Stops ignoring a name. */
  unignoreName(zoomName: string): Promise<void>;

  // --- ignored for one prickle ---
  /** Every per-prickle ignore: the name and the prickle. */
  ignoredAppearances(): Promise<Pick<IgnoredZoomAppearanceRow, "zoom_name" | "prickle_id">[]>;
  /** The names ignored for this prickle, with the reason. */
  ignoredAppearancesOf(prickleId: string): Promise<Pick<IgnoredZoomAppearanceRow, "zoom_name" | "reason">[]>;
  /** Ignores a name for one prickle. Ignoring it again changes nothing (the first reason stays). */
  ignoreAppearance(input: { prickleId: string; zoomName: string; reason: string | null; ignoredBy: string | null }): Promise<void>;
  /** Stops ignoring a name for one prickle. */
  unignoreAppearance(prickleId: string, zoomName: string): Promise<void>;

  // --- ambiguous names ---
  /** The unresolved ambiguous names (name and email), in id order. */
  unresolvedAmbiguousNames(): Promise<Pick<AmbiguousZoomNameRow, "zoom_name" | "zoom_email">[]>;
  /** Whether an unresolved entry exists for this name (any email). */
  hasUnresolvedAmbiguousName(zoomName: string): Promise<boolean>;
  /** Marks every unresolved entry for the name resolved to the member. */
  resolveAmbiguousName(zoomName: string, memberId: string): Promise<void>;
  /** Marks every unresolved entry for the name ignored. */
  ignoreAmbiguousName(zoomName: string): Promise<void>;
  /** A member merge: entries resolved to `fromMemberId` now point at `toMemberId`, and `toMemberId` replaces `fromMemberId` among the candidates (once). */
  reassignAmbiguousMember(fromMemberId: string, toMemberId: string): Promise<void>;

  // --- how to join the prickle room ---
  /** The join settings, newest effective first; two for the same instant (a correction) with the one saved last first. A handful of rows, not paginated. */
  joinSettings(): Promise<Pick<PrickleJoinSettingRow, "id" | "join_url" | "meeting_id" | "passcode" | "effective_from" | "created_at">[]>;
  /** Adds a join setting. */
  addJoinSetting(setting: NewPrickleJoinSetting): Promise<void>;
  /** Removes a join setting; false when there was none to remove (or the database refuses: once a setting is in effect, a user's client can no longer remove it). */
  removeJoinSetting(id: string): Promise<boolean>;

  // --- live presence ---
  /** Records a join or leave the webhook saw. Seeing the same one again (meeting, participant, event, time) changes nothing. */
  recordParticipantEvent(event: NewZoomParticipantEvent): Promise<void>;
  /** The participant events at or after an instant, in id order. */
  participantEventsSince(since: string): Promise<ZoomParticipantEvent[]>;

  // --- in-meeting chat (service role only: it holds the text) ---
  /** Records a chat message the webhook saw. Seeing the same one again (meeting, message id) changes nothing. */
  recordChatMessage(message: NewZoomChatMessage): Promise<void>;
  /** The chat messages sent at or after an instant, in id order. */
  chatMessagesSince(since: string): Promise<ZoomChatMessageRow[]>;
}

export class SupabaseZoomRepository implements ZoomRepository {
  constructor(private readonly db: Db) {}

  private get attendees() {
    return this.db.schema("bronze").from("zoom_attendees");
  }

  private get meetings() {
    return this.db.schema("bronze").from("zoom_meetings");
  }

  private get ignored() {
    return this.db.from("ignored_zoom_names");
  }

  /** The rows whose meeting the Silver layer takes in (see `isMeetingKept`). */
  private async onlyKept<T extends { zoom_account?: string | null; meeting_uuid?: string | null; meeting_id?: string | null }>(rows: T[]): Promise<T[]> {
    if (rows.length === 0) return rows;
    const policy = await this.keepPolicy();
    return rows.filter((r) => isMeetingKept(policy, { zoomAccount: r.zoom_account, meetingUuid: r.meeting_uuid, meetingId: r.meeting_id }));
  }

  async accounts() {
    const rows = await fetchAllRows<ZoomAccountRow>((a, b) => this.db.from("zoom_accounts").select("*").order("created_at").order("id").range(a, b));
    return rows.map(toAccount);
  }

  async createAccount(input: { slug: string; label: string; hostEmail: string | null; defaultPolicy: ZoomDefaultPolicy; credentialsPrefix: string }) {
    const { data, error } = await this.db
      .from("zoom_accounts")
      .insert({ slug: input.slug, label: input.label, host_email: input.hostEmail, default_policy: input.defaultPolicy, credentials_prefix: input.credentialsPrefix })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return toAccount(data);
  }

  async keepPolicy() {
    const [accounts, rows] = await Promise.all([
      this.accounts(),
      fetchAllRows<ZoomDecisionRow>((a, b) => this.db.from("zoom_meeting_decisions").select("*").order("id").range(a, b)),
    ]);
    return buildKeepPolicy(accounts, rows.map(toDecisionRef));
  }

  async setDecision({ zoomAccount, scope, zoomKey, decision, decidedBy }: { zoomAccount: string; scope: ZoomDecisionScope; zoomKey: string; decision: ZoomDecision; decidedBy: string | null }) {
    const { error } = await this.db
      .from("zoom_meeting_decisions")
      .upsert(
        { zoom_account: zoomAccount, scope, zoom_key: zoomKey, decision, decided_by: decidedBy, decided_at: new Date().toISOString() },
        { onConflict: "zoom_account,scope,zoom_key" }
      );
    if (error) throw new Error(error.message);
  }

  async clearDecision({ zoomAccount, scope, zoomKey }: { zoomAccount: string; scope: ZoomDecisionScope; zoomKey: string }) {
    const { error } = await this.db.from("zoom_meeting_decisions").delete().eq("zoom_account", zoomAccount).eq("scope", scope).eq("zoom_key", zoomKey);
    if (error) throw new Error(error.message);
  }

  async reviewMeetings() {
    const policy = await this.keepPolicy();
    const accountIds = [...policy.accounts.values()].filter((a) => a.defaultPolicy === "exclude").map((a) => a.id);
    if (accountIds.length === 0) return [];
    type R = Pick<ZoomMeetingRow, "zoom_account" | "meeting_uuid" | "meeting_id" | "topic" | "start_time" | "end_time" | "host_email" | "participant_count">;
    const rows = await fetchAllRows<R>((a, b) =>
      this.meetings
        .select("zoom_account, meeting_uuid, meeting_id, topic, start_time, end_time, host_email, participant_count")
        .in("zoom_account", accountIds)
        .order("start_time", { ascending: false })
        .order("id")
        .range(a, b)
    );
    return rows.map((r) => toReviewMeeting(policy, r));
  }

  async undecidedMeetingCount() {
    return (await this.reviewMeetings()).filter((m) => m.state === "undecided").length;
  }

  async meetingSpan({ zoomAccount, scope, zoomKey }: { zoomAccount: string; scope: ZoomDecisionScope; zoomKey: string }) {
    const rows = await fetchAllRows<Pick<ZoomMeetingRow, "start_time" | "end_time">>((a, b) =>
      this.meetings
        .select("start_time, end_time")
        .eq("zoom_account", zoomAccount)
        .eq(scope === "instance" ? "meeting_uuid" : "meeting_id", zoomKey)
        .order("id")
        .range(a, b)
    );
    return spanOf(rows);
  }

  async attendeeCount() {
    const { count, error } = await this.attendees.select("*", { count: "exact", head: true });
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async attendeesForMatching({ withMeetingOnly = false }: { withMeetingOnly?: boolean } = {}) {
    const rows = await fetchAllRows<ZoomAttendeeRef & { meeting_id: string; zoom_account: string }>((a, b) => {
      let query = this.attendees.select("name, email, meeting_uuid, join_time, leave_time, meeting_id, zoom_account");
      if (withMeetingOnly) query = query.not("meeting_uuid", "is", null);
      return query.order("id").range(a, b);
    });
    return (await this.onlyKept(rows)).map(({ name, email, meeting_uuid, join_time, leave_time }) => ({ name, email, meeting_uuid, join_time, leave_time }));
  }

  async attendeesSince(from: string) {
    const rows = await fetchAllRows<Pick<ZoomAttendeeRow, "name" | "email" | "meeting_uuid" | "meeting_id" | "zoom_account">>(
      (a, b) => this.attendees.select("name, email, meeting_uuid, meeting_id, zoom_account").gte("join_time", from).order("id").range(a, b)
    );
    return (await this.onlyKept(rows)).map(({ name, email, meeting_uuid }) => ({ name, email, meeting_uuid }));
  }

  async attendeeNamesOverlapping(from: string, to: string) {
    const rows = await fetchAllRows<Pick<ZoomAttendeeRow, "name" | "email" | "meeting_uuid" | "meeting_id" | "zoom_account">>(
      (a, b) =>
        this.attendees.select("name, email, meeting_uuid, meeting_id, zoom_account").lt("join_time", to).gt("leave_time", from).order("id").range(a, b)
    );
    return (await this.onlyKept(rows)).map(({ name, email }) => ({ name, email }));
  }

  async attendeesOverlapping(from: string, to: string) {
    return this.onlyKept(
      await fetchAllRows<ZoomAttendeeRow>(
        (a, b) => this.attendees.select("*").lt("join_time", to).gt("leave_time", from).order("join_time").order("id").range(a, b)
      )
    );
  }

  async appearancesOf(names: string[]) {
    const rows: (ZoomNameAppearance & { zoom_account: string })[] = [];
    for (const part of chunk([...new Set(names)], PAGE_CHUNK)) {
      rows.push(
        ...(await fetchAllRows<ZoomNameAppearance & { zoom_account: string }>(
          (a, b) =>
            this.attendees.select("name, email, join_time, topic, meeting_uuid, meeting_id, zoom_account").in("name", part).order("id").range(a, b)
        ))
      );
    }
    return (await this.onlyKept(rows)).map(({ name, email, join_time, topic, meeting_uuid, meeting_id }) => ({ name, email, join_time, topic, meeting_uuid, meeting_id }));
  }

  async meetingCountsByName(names: string[]) {
    const meetings = new Map<string, Set<string>>();
    for (const part of chunk([...new Set(names)], PAGE_CHUNK)) {
      const rows = await this.onlyKept(
        await fetchAllRows<{ name: string; meeting_uuid: string | null; meeting_id: string; zoom_account: string }>(
          (a, b) =>
            this.attendees.select("name, meeting_uuid, meeting_id, zoom_account").in("name", part).not("meeting_uuid", "is", null).order("id").range(a, b)
        )
      );
      for (const r of rows) {
        if (!r.meeting_uuid) continue;
        const set = meetings.get(r.name) ?? new Set<string>();
        set.add(r.meeting_uuid);
        meetings.set(r.name, set);
      }
    }
    return new Map([...meetings].map(([name, set]) => [name, set.size]));
  }

  async meetingUuidsForName(name: string) {
    const rows = await this.onlyKept(
      await fetchAllRows<{ meeting_uuid: string | null; meeting_id: string; zoom_account: string }>(
        (a, b) => this.attendees.select("meeting_uuid, meeting_id, zoom_account").eq("name", name).not("meeting_uuid", "is", null).order("id").range(a, b)
      )
    );
    return [...new Set(rows.flatMap((r) => (r.meeting_uuid ? [r.meeting_uuid] : [])))];
  }

  async attendeesInSessions(sessionKeys: string[]) {
    type Row = Pick<ZoomAttendeeRow, "id" | "name" | "email" | "meeting_uuid" | "meeting_id" | "zoom_account">;
    const result = new Map<string, { name: string; email: string | null }[]>();
    const seen = new Set<string>();
    for (const part of chunk([...new Set(sessionKeys)], SESSION_CHUNK)) {
      // The attendance run groups by meeting_uuid, falling back to meeting_id; look up both.
      for (const column of ["meeting_uuid", "meeting_id"] as const) {
        const rows = await this.onlyKept(
          await fetchAllRows<Row>(
            (a, b) => this.attendees.select("id, name, email, meeting_uuid, meeting_id, zoom_account").in(column, part).order("id").range(a, b)
          )
        );
        for (const r of rows) {
          const key = r.meeting_uuid || r.meeting_id;
          if (!part.includes(key) || seen.has(r.id)) continue;
          seen.add(r.id);
          result.set(key, [...(result.get(key) ?? []), { name: r.name, email: r.email }]);
        }
      }
    }
    return result;
  }

  async attendeesOfSessions(sessionKeys: string[]) {
    const result: ZoomAttendeeRow[] = [];
    const seen = new Set<string>();
    for (const part of chunk([...new Set(sessionKeys)], SESSION_CHUNK)) {
      // The attendance run groups by meeting_uuid, falling back to meeting_id; look up both.
      for (const column of ["meeting_uuid", "meeting_id"] as const) {
        const rows = await this.onlyKept(
          await fetchAllRows<ZoomAttendeeRow>(
            (a, b) => this.attendees.select("*").in(column, part).order("id").range(a, b)
          )
        );
        for (const r of rows) {
          const key = r.meeting_uuid || r.meeting_id;
          if (!part.includes(key) || seen.has(r.id)) continue;
          seen.add(r.id);
          result.push(r);
        }
      }
    }
    return result.sort((a, b) => (a.join_time < b.join_time ? -1 : a.join_time > b.join_time ? 1 : a.id < b.id ? -1 : 1));
  }

  async upsertAttendees(rows: NewZoomAttendee[]) {
    await upsertInChunks(this.attendees, rows, "meeting_uuid,name,join_time", WRITE_CHUNK);
  }

  async latestMeetingStart() {
    const { data, error } = await this.meetings.select("start_time").order("start_time", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    return data?.start_time ?? null;
  }

  async upsertMeeting(meeting: NewZoomMeeting) {
    const { error } = await this.meetings.upsert(meeting, { onConflict: "meeting_uuid", ignoreDuplicates: false });
    if (error) throw new Error(error.message);
  }

  async importedHostIds(since: string) {
    const rows = await this.onlyKept(
      await fetchAllRows<{ host_id: string | null; zoom_account: string; meeting_uuid: string; meeting_id: string }>(
        (a, b) => this.meetings.select("id, host_id:data->>host_id, zoom_account, meeting_uuid, meeting_id").gte("start_time", since).order("id").range(a, b)
      )
    );
    return new Set(rows.flatMap((r) => (r.host_id ? [r.host_id] : [])));
  }

  async ignoredNames() {
    const rows = await fetchAllRows<{ zoom_name: string }>((a, b) => this.ignored.select("zoom_name").order("id").range(a, b));
    return rows.map((r) => r.zoom_name);
  }

  async ignoreName({ zoomName, reason, ignoredBy }: { zoomName: string; reason: string | null; ignoredBy: string | null }) {
    const { error } = await this.ignored.insert({ zoom_name: zoomName, reason, ignored_by: ignoredBy });
    if (error) throw new Error(error.message);
  }

  async unignoreName(zoomName: string) {
    const { error } = await this.ignored.delete().eq("zoom_name", zoomName);
    if (error) throw new Error(error.message);
  }

  async ignoredAppearances() {
    type R = Pick<IgnoredZoomAppearanceRow, "zoom_name" | "prickle_id">;
    return fetchAllRows<R>((a, b) => this.db.from("ignored_zoom_appearances").select("zoom_name, prickle_id").order("id").range(a, b));
  }

  async ignoredAppearancesOf(prickleId: string) {
    const { data, error } = await this.db.from("ignored_zoom_appearances").select("zoom_name, reason").eq("prickle_id", prickleId);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async ignoreAppearance({ prickleId, zoomName, reason, ignoredBy }: { prickleId: string; zoomName: string; reason: string | null; ignoredBy: string | null }) {
    const { error } = await this.db
      .from("ignored_zoom_appearances")
      .upsert({ prickle_id: prickleId, zoom_name: zoomName, reason, ignored_by: ignoredBy }, { onConflict: "prickle_id,zoom_name", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }

  async unignoreAppearance(prickleId: string, zoomName: string) {
    const { error } = await this.db.from("ignored_zoom_appearances").delete().eq("prickle_id", prickleId).eq("zoom_name", zoomName);
    if (error) throw new Error(error.message);
  }

  async unresolvedAmbiguousNames() {
    type R = Pick<AmbiguousZoomNameRow, "zoom_name" | "zoom_email">;
    return fetchAllRows<R>(
      (a, b) => this.db.from("ambiguous_zoom_names").select("zoom_name, zoom_email").eq("status", "unresolved").order("id").range(a, b)
    );
  }

  async hasUnresolvedAmbiguousName(zoomName: string) {
    const { count, error } = await this.db
      .from("ambiguous_zoom_names")
      .select("zoom_name", { count: "exact", head: true })
      .eq("zoom_name", zoomName)
      .eq("status", "unresolved");
    if (error) throw new Error(error.message);
    return (count ?? 0) > 0;
  }

  async resolveAmbiguousName(zoomName: string, memberId: string) {
    const { error } = await this.db
      .from("ambiguous_zoom_names")
      .update({ status: "resolved", resolved_member_id: memberId })
      .eq("zoom_name", zoomName)
      .eq("status", "unresolved");
    if (error) throw new Error(error.message);
  }

  async ignoreAmbiguousName(zoomName: string) {
    const { error } = await this.db.from("ambiguous_zoom_names").update({ status: "ignored" }).eq("zoom_name", zoomName).eq("status", "unresolved");
    if (error) throw new Error(error.message);
  }

  async reassignAmbiguousMember(fromMemberId: string, toMemberId: string) {
    const resolved = await this.db.from("ambiguous_zoom_names").update({ resolved_member_id: toMemberId }).eq("resolved_member_id", fromMemberId);
    if (resolved.error) throw new Error(resolved.error.message);
    // PostgREST can't replace one array element in place: read the entries that list the member and patch each.
    type R = Pick<AmbiguousZoomNameRow, "id" | "candidate_member_ids">;
    const rows = await fetchAllRows<R>(
      (a, b) =>
        this.db.from("ambiguous_zoom_names").select("id, candidate_member_ids").contains("candidate_member_ids", [fromMemberId]).order("id").range(a, b)
    );
    for (const part of chunk(rows, PAGE_CHUNK)) {
      const results = await Promise.all(
        part.map((row) =>
          this.db
            .from("ambiguous_zoom_names")
            .update({ candidate_member_ids: replaceCandidate(row.candidate_member_ids, fromMemberId, toMemberId) })
            .eq("id", row.id)
        )
      );
      const failed = results.find((r) => r.error);
      if (failed?.error) throw new Error(failed.error.message);
    }
  }

  async joinSettings() {
    const { data, error } = await this.db
      .from("prickle_join_settings")
      .select("id, join_url, meeting_id, passcode, effective_from, created_at")
      .order("effective_from", { ascending: false })
      // Two rows for the same instant (a correction): the one saved last wins.
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async addJoinSetting({ joinUrl, meetingId, passcode, effectiveFrom, createdBy }: NewPrickleJoinSetting) {
    const { error } = await this.db
      .from("prickle_join_settings")
      .insert({ join_url: joinUrl, meeting_id: meetingId, passcode, effective_from: effectiveFrom, created_by: createdBy });
    if (error) throw new Error(error.message);
  }

  async removeJoinSetting(id: string) {
    const { data, error } = await this.db.from("prickle_join_settings").delete().eq("id", id).select("id");
    if (error) throw new Error(error.message);
    return (data ?? []).length > 0;
  }

  async recordParticipantEvent(event: NewZoomParticipantEvent) {
    const { error } = await this.db
      .schema("bronze")
      .from("zoom_participant_events")
      .upsert(event, { onConflict: "meeting_uuid,participant_key,event,event_time", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }

  async participantEventsSince(since: string) {
    const rows = await this.onlyKept(
      await fetchAllRows(
        (a, b) =>
          this.db
            .schema("bronze")
            .from("zoom_participant_events")
            .select("id, meeting_uuid, host_id, participant_key, participant_name, participant_email, event, event_time, zoom_account")
            .gte("event_time", since)
            .order("id")
            .range(a, b)
      )
    );
    // The column is text; the webhook only writes "joined" and "left".
    return rows.map(({ zoom_account: _account, ...row }) => ({ ...row, event: row.event as ZoomParticipantEvent["event"] }));
  }

  async recordChatMessage(message: NewZoomChatMessage) {
    const { error } = await this.db
      .schema("bronze")
      .from("zoom_chat_messages")
      .upsert(message, { onConflict: "meeting_uuid,message_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }

  async chatMessagesSince(since: string) {
    return this.onlyKept(
      await fetchAllRows((a, b) =>
        this.db
          .schema("bronze")
          .from("zoom_chat_messages")
          .select("*")
          .gte("sent_at", since)
          .order("id")
          .range(a, b)
      )
    );
  }
}

function toAccount(row: ZoomAccountRow): ZoomAccount {
  return {
    id: row.id,
    slug: row.slug,
    label: row.label,
    hostEmail: row.host_email,
    defaultPolicy: row.default_policy as ZoomDefaultPolicy,
    credentialsPrefix: row.credentials_prefix,
  };
}

function toDecisionRef(row: ZoomDecisionRow): ZoomDecisionRef {
  return { zoomAccount: row.zoom_account, scope: row.scope as ZoomDecisionScope, zoomKey: row.zoom_key, decision: row.decision as ZoomDecision };
}

function toReviewMeeting(
  policy: ZoomKeepPolicy,
  r: Pick<ZoomMeetingRow, "zoom_account" | "meeting_uuid" | "meeting_id" | "topic" | "start_time" | "end_time" | "host_email" | "participant_count">
): ZoomReviewMeeting {
  return {
    zoomAccount: r.zoom_account,
    meetingUuid: r.meeting_uuid,
    meetingId: r.meeting_id,
    topic: r.topic,
    startTime: r.start_time,
    endTime: r.end_time,
    hostEmail: r.host_email,
    participantCount: r.participant_count,
    state: meetingState(policy, { zoomAccount: r.zoom_account, meetingUuid: r.meeting_uuid, meetingId: r.meeting_id }),
  };
}

/** The earliest start and latest end of some meetings (a meeting with no end ends where it starts), or null for none. */
function spanOf(rows: { start_time: string; end_time: string | null }[]): { from: string; to: string } | null {
  if (rows.length === 0) return null;
  let from = rows[0].start_time;
  let to = rows[0].end_time ?? rows[0].start_time;
  for (const r of rows) {
    if (r.start_time < from) from = r.start_time;
    const end = r.end_time ?? r.start_time;
    if (end > to) to = end;
  }
  return { from, to };
}

/** The candidate ids with `from` swapped for `to` (kept once, at the end). */
function replaceCandidate(ids: string[], from: string, to: string): string[] {
  const without = ids.filter((id) => id !== from);
  return without.includes(to) ? without : [...without, to];
}

const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryZoomRepository implements ZoomRepository {
  constructor(private readonly data: InMemoryDataset) {}

  private kept<T extends { zoom_account?: string | null; meeting_uuid?: string | null; meeting_id?: string | null }>(rows: T[]): T[] {
    const policy = buildKeepPolicy(this.data.zoomAccounts.map(toAccount), this.data.zoomDecisions.map(toDecisionRef));
    return rows.filter((r) => isMeetingKept(policy, { zoomAccount: r.zoom_account, meetingUuid: r.meeting_uuid, meetingId: r.meeting_id }));
  }

  async accounts() {
    return [...this.data.zoomAccounts].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1)).map(toAccount);
  }

  async createAccount(input: { slug: string; label: string; hostEmail: string | null; defaultPolicy: ZoomDefaultPolicy; credentialsPrefix: string }) {
    if (this.data.zoomAccounts.some((a) => a.slug === input.slug || a.credentials_prefix === input.credentialsPrefix)) {
      throw new Error("duplicate key value violates unique constraint on zoom_accounts");
    }
    const now = new Date().toISOString();
    const row: ZoomAccountRow = {
      id: `zacc_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
      slug: input.slug,
      label: input.label,
      host_email: input.hostEmail,
      default_policy: input.defaultPolicy,
      credentials_prefix: input.credentialsPrefix,
      created_at: now,
      updated_at: now,
    };
    this.data.zoomAccounts.push(row);
    return toAccount(row);
  }

  async keepPolicy() {
    return buildKeepPolicy(this.data.zoomAccounts.map(toAccount), this.data.zoomDecisions.map(toDecisionRef));
  }

  async setDecision({ zoomAccount, scope, zoomKey, decision, decidedBy }: { zoomAccount: string; scope: ZoomDecisionScope; zoomKey: string; decision: ZoomDecision; decidedBy: string | null }) {
    if (!this.data.zoomAccounts.some((a) => a.id === zoomAccount)) throw new Error("violates foreign key constraint zoom_meeting_decisions_zoom_account_fkey");
    const existing = this.data.zoomDecisions.find((d) => d.zoom_account === zoomAccount && d.scope === scope && d.zoom_key === zoomKey);
    const decidedAt = new Date().toISOString();
    if (existing) Object.assign(existing, { decision, decided_by: decidedBy, decided_at: decidedAt });
    else this.data.zoomDecisions.push({ id: `zmdc_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`, zoom_account: zoomAccount, scope, zoom_key: zoomKey, decision, decided_by: decidedBy, decided_at: decidedAt });
  }

  async clearDecision({ zoomAccount, scope, zoomKey }: { zoomAccount: string; scope: ZoomDecisionScope; zoomKey: string }) {
    this.data.zoomDecisions = this.data.zoomDecisions.filter((d) => !(d.zoom_account === zoomAccount && d.scope === scope && d.zoom_key === zoomKey));
  }

  async reviewMeetings() {
    const policy = await this.keepPolicy();
    const accountIds = new Set([...policy.accounts.values()].filter((a) => a.defaultPolicy === "exclude").map((a) => a.id));
    return this.data.zoomMeetings
      .filter((m) => accountIds.has(m.zoom_account))
      .sort((a, b) => (a.start_time < b.start_time ? 1 : a.start_time > b.start_time ? -1 : a.id < b.id ? -1 : 1))
      .map((m) => toReviewMeeting(policy, m));
  }

  async undecidedMeetingCount() {
    return (await this.reviewMeetings()).filter((m) => m.state === "undecided").length;
  }

  async meetingSpan({ zoomAccount, scope, zoomKey }: { zoomAccount: string; scope: ZoomDecisionScope; zoomKey: string }) {
    return spanOf(this.data.zoomMeetings.filter((m) => m.zoom_account === zoomAccount && (scope === "instance" ? m.meeting_uuid : m.meeting_id) === zoomKey));
  }

  async attendeeCount() {
    return this.data.zoomAttendees.length;
  }

  async attendeesForMatching({ withMeetingOnly = false }: { withMeetingOnly?: boolean } = {}) {
    return byId(this.kept(this.data.zoomAttendees))
      .filter((a) => !withMeetingOnly || a.meeting_uuid !== null)
      .map(({ name, email, meeting_uuid, join_time, leave_time }) => ({ name, email, meeting_uuid, join_time, leave_time }));
  }

  async attendeesSince(from: string) {
    return byId(this.kept(this.data.zoomAttendees))
      .filter((a) => a.join_time >= from)
      .map(({ name, email, meeting_uuid }) => ({ name, email, meeting_uuid }));
  }

  async attendeeNamesOverlapping(from: string, to: string) {
    return byId(this.kept(this.data.zoomAttendees))
      .filter((a) => a.join_time < to && a.leave_time > from)
      .map(({ name, email }) => ({ name, email }));
  }

  async attendeesOverlapping(from: string, to: string) {
    return this.kept(this.data.zoomAttendees)
      .filter((a) => a.join_time < to && a.leave_time > from)
      .sort((a, b) => (a.join_time < b.join_time ? -1 : a.join_time > b.join_time ? 1 : a.id < b.id ? -1 : 1))
      .map((a) => ({ ...a }));
  }

  async appearancesOf(names: string[]) {
    const wanted = new Set(names);
    return byId(this.kept(this.data.zoomAttendees))
      .filter((a) => wanted.has(a.name))
      .map(({ name, email, join_time, topic, meeting_uuid, meeting_id }) => ({ name, email, join_time, topic, meeting_uuid, meeting_id }));
  }

  async meetingCountsByName(names: string[]) {
    const wanted = new Set(names);
    const meetings = new Map<string, Set<string>>();
    for (const a of this.kept(this.data.zoomAttendees)) {
      if (!wanted.has(a.name) || !a.meeting_uuid) continue;
      meetings.set(a.name, (meetings.get(a.name) ?? new Set()).add(a.meeting_uuid));
    }
    return new Map([...meetings].map(([name, set]) => [name, set.size]));
  }

  async meetingUuidsForName(name: string) {
    return [...new Set(byId(this.kept(this.data.zoomAttendees)).flatMap((a) => (a.name === name && a.meeting_uuid ? [a.meeting_uuid] : [])))];
  }

  async attendeesInSessions(sessionKeys: string[]) {
    const wanted = new Set(sessionKeys);
    const result = new Map<string, { name: string; email: string | null }[]>();
    for (const a of byId(this.kept(this.data.zoomAttendees))) {
      const key = a.meeting_uuid || a.meeting_id;
      if (!wanted.has(key)) continue;
      result.set(key, [...(result.get(key) ?? []), { name: a.name, email: a.email }]);
    }
    return result;
  }

  async attendeesOfSessions(sessionKeys: string[]) {
    const wanted = new Set(sessionKeys);
    return this.kept(this.data.zoomAttendees)
      .filter((a) => wanted.has(a.meeting_uuid || a.meeting_id))
      .sort((a, b) => (a.join_time < b.join_time ? -1 : a.join_time > b.join_time ? 1 : a.id < b.id ? -1 : 1))
      .map((a) => ({ ...a }));
  }

  async upsertAttendees(rows: NewZoomAttendee[]) {
    for (const r of rows) {
      // The database's unique index never matches a row with no meeting uuid (null is distinct).
      const existing = r.meeting_uuid ? this.data.zoomAttendees.find((x) => x.meeting_uuid === r.meeting_uuid && x.name === r.name && x.join_time === r.join_time) : undefined;
      if (existing) {
        Object.assign(existing, r, { id: existing.id });
      } else {
        this.data.zoomAttendees.push({
          id: r.id ?? crypto.randomUUID(),
          attentiveness_score: null,
          created_at: null,
          email: null,
          failover: null,
          meeting_uuid: null,
          participant_id: null,
          raw_payload: null,
          registrant_id: null,
          status: null,
          topic: null,
          user_id: null,
          zoom_account: PRIMARY_ZOOM_ACCOUNT_ID,
          ...r,
        });
      }
    }
  }

  async latestMeetingStart() {
    const starts = this.data.zoomMeetings.map((m) => m.start_time);
    return starts.length ? starts.reduce((a, b) => (a > b ? a : b)) : null;
  }

  async upsertMeeting(meeting: NewZoomMeeting) {
    const existing = this.data.zoomMeetings.find((m) => m.meeting_uuid === meeting.meeting_uuid);
    if (existing) {
      Object.assign(existing, meeting, { id: existing.id });
    } else {
      this.data.zoomMeetings.push({
        id: meeting.id ?? crypto.randomUUID(),
        duration_minutes: null,
        end_time: null,
        host_email: null,
        host_name: null,
        imported_at: null,
        participant_count: null,
        updated_at: null,
        zoom_account: PRIMARY_ZOOM_ACCOUNT_ID,
        ...meeting,
      });
    }
  }

  async importedHostIds(since: string) {
    const hosts = this.kept(this.data.zoomMeetings)
      .filter((m) => m.start_time >= since)
      .map((m) => (m.data && typeof m.data === "object" && !Array.isArray(m.data) ? m.data.host_id : null))
      .flatMap((h) => (typeof h === "string" && h ? [h] : []));
    return new Set(hosts);
  }

  async ignoredNames() {
    return byId(this.data.ignoredZoomNames).map((r) => r.zoom_name);
  }

  async ignoreName({ zoomName, reason, ignoredBy }: { zoomName: string; reason: string | null; ignoredBy: string | null }) {
    if (this.data.ignoredZoomNames.some((r) => r.zoom_name === zoomName)) throw new Error(`${zoomName} is already ignored`);
    this.data.ignoredZoomNames.push({ id: crypto.randomUUID(), zoom_name: zoomName, reason, ignored_by: ignoredBy, ignored_at: null, created_at: null });
  }

  async unignoreName(zoomName: string) {
    this.data.ignoredZoomNames = this.data.ignoredZoomNames.filter((r) => r.zoom_name !== zoomName);
  }

  async ignoredAppearances() {
    return byId(this.data.ignoredZoomAppearances).map(({ zoom_name, prickle_id }) => ({ zoom_name, prickle_id }));
  }

  async ignoredAppearancesOf(prickleId: string) {
    return this.data.ignoredZoomAppearances.filter((r) => r.prickle_id === prickleId).map(({ zoom_name, reason }) => ({ zoom_name, reason }));
  }

  async ignoreAppearance({ prickleId, zoomName, reason, ignoredBy }: { prickleId: string; zoomName: string; reason: string | null; ignoredBy: string | null }) {
    if (this.data.ignoredZoomAppearances.some((r) => r.prickle_id === prickleId && r.zoom_name === zoomName)) return;
    this.data.ignoredZoomAppearances.push({ id: crypto.randomUUID(), prickle_id: prickleId, zoom_name: zoomName, reason, ignored_by: ignoredBy, ignored_at: new Date().toISOString() });
  }

  async unignoreAppearance(prickleId: string, zoomName: string) {
    this.data.ignoredZoomAppearances = this.data.ignoredZoomAppearances.filter((r) => !(r.prickle_id === prickleId && r.zoom_name === zoomName));
  }

  async unresolvedAmbiguousNames() {
    return byId(this.data.ambiguousZoomNames)
      .filter((r) => r.status === "unresolved")
      .map(({ zoom_name, zoom_email }) => ({ zoom_name, zoom_email }));
  }

  async hasUnresolvedAmbiguousName(zoomName: string) {
    return this.data.ambiguousZoomNames.some((r) => r.zoom_name === zoomName && r.status === "unresolved");
  }

  async resolveAmbiguousName(zoomName: string, memberId: string) {
    for (const r of this.data.ambiguousZoomNames) {
      if (r.zoom_name === zoomName && r.status === "unresolved") Object.assign(r, { status: "resolved", resolved_member_id: memberId });
    }
  }

  async ignoreAmbiguousName(zoomName: string) {
    for (const r of this.data.ambiguousZoomNames) {
      if (r.zoom_name === zoomName && r.status === "unresolved") r.status = "ignored";
    }
  }

  async reassignAmbiguousMember(fromMemberId: string, toMemberId: string) {
    for (const r of this.data.ambiguousZoomNames) {
      if (r.resolved_member_id === fromMemberId) r.resolved_member_id = toMemberId;
      if (r.candidate_member_ids.includes(fromMemberId)) r.candidate_member_ids = replaceCandidate(r.candidate_member_ids, fromMemberId, toMemberId);
    }
  }

  async joinSettings() {
    return [...this.data.joinSettings]
      .sort((a, b) => (a.effective_from < b.effective_from ? 1 : a.effective_from > b.effective_from ? -1 : a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
      .map(({ id, join_url, meeting_id, passcode, effective_from, created_at }) => ({ id, join_url, meeting_id, passcode, effective_from, created_at }));
  }

  async addJoinSetting({ joinUrl, meetingId, passcode, effectiveFrom, createdBy }: NewPrickleJoinSetting) {
    this.data.joinSettings.push({
      id: crypto.randomUUID(),
      join_url: joinUrl,
      meeting_id: meetingId,
      passcode,
      effective_from: effectiveFrom,
      created_by: createdBy,
      // Rising, like the database's now(), so two saved in a row keep their order.
      created_at: new Date(Math.max(Date.now(), ...this.data.joinSettings.map((j) => Date.parse(j.created_at) + 1))).toISOString(),
    });
  }

  async removeJoinSetting(id: string) {
    const before = this.data.joinSettings.length;
    this.data.joinSettings = this.data.joinSettings.filter((j) => j.id !== id);
    return this.data.joinSettings.length < before;
  }

  async recordParticipantEvent(event: NewZoomParticipantEvent) {
    const seen = this.data.zoomParticipantEvents.some(
      (r) => r.meeting_uuid === event.meeting_uuid && r.participant_key === event.participant_key && r.event === event.event && r.event_time === event.event_time
    );
    if (seen) return;
    this.data.zoomParticipantEvents.push({
      id: event.id ?? crypto.randomUUID(),
      host_id: null,
      leave_reason: null,
      meeting_id: null,
      participant_email: null,
      participant_name: null,
      received_at: new Date().toISOString(),
      zoom_account: PRIMARY_ZOOM_ACCOUNT_ID,
      ...event,
      raw_payload: event.raw_payload ?? null,
    });
  }

  async participantEventsSince(since: string) {
    return byId(this.kept(this.data.zoomParticipantEvents))
      .filter((r) => r.event_time >= since)
      .map(({ id, meeting_uuid, host_id, participant_key, participant_name, participant_email, event, event_time }) => ({
        id,
        meeting_uuid,
        host_id,
        participant_key,
        participant_name,
        participant_email,
        event: event as "joined" | "left",
        event_time,
      }));
  }
  async recordChatMessage(message: NewZoomChatMessage) {
    const seen = this.data.zoomChatMessages.some((r) => r.meeting_uuid === message.meeting_uuid && r.message_id === message.message_id);
    if (seen) return;
    this.data.zoomChatMessages.push({
      id: message.id ?? `zmmsg_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
      breakout_room_uuid: null,
      has_files: false,
      meeting_id: null,
      message_text: "",
      received_at: new Date().toISOString(),
      recipient_context: null,
      recipient_email: null,
      recipient_name: null,
      recipient_session_id: null,
      recipient_type: null,
      sender_context: null,
      sender_email: null,
      sender_name: null,
      sender_session_id: null,
      sender_type: null,
      zoom_account: PRIMARY_ZOOM_ACCOUNT_ID,
      ...message,
      raw_payload: message.raw_payload ?? null,
    });
  }

  async chatMessagesSince(since: string) {
    return byId(this.kept(this.data.zoomChatMessages)).filter((r) => r.sent_at >= since);
  }
}
