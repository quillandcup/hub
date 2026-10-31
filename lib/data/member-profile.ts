import { fetchAllRows } from "@/lib/supabase/paginate";
import { compareText, inChunks, type Page } from "./query";
import type { Db, Row, Update } from "./db";
import type { InMemoryDataset } from "./in-memory";

/** Ids per `.in(...)` filter, so the request URL stays under the length limit even with long ids. */
const ID_CHUNK_SIZE = 100;

/** A member's private note about another member, as shown back to its author. */
export type MemberNote = Pick<Row<"member_notes">, "body" | "updated_at">;

/** The tour state a member's Getting started guide is built from (`member_onboarding`). */
export type OnboardingRecord = Pick<Row<"member_onboarding">, "marked_steps" | "dismissed_at" | "completed_at" | "acknowledged_steps">;
/** The tour fields a save may change; `updated_at` is stamped by the repository. */
export type OnboardingFields = Partial<OnboardingRecord>;

/** A member's Slack connection, without the token secrets (those never leave the database functions). */
export type SlackConnection = Pick<Row<"member_slack_connections">, "slack_user_id" | "connected_at" | "revoked_at" | "scopes">;

/**
 * What a member keeps about their profile beyond the members row: "Ask me about" topics, private notes about other
 * members, the roster opt-out, the Getting started tour and the Slack connection (`member_ask_me_about`,
 * `member_notes`, `member_roster_opt_outs`, `member_onboarding`, `member_slack_connections`). Local data. The
 * client decides privilege: member writes run under the member's session (RLS scopes them to their own row), and
 * notes are author-only with no admin access, so they are never read or written with another member's identity.
 * Every method throws on a database error; scans are paginated and id lists chunked.
 */
export interface MemberProfileRepository {
  // --- Ask me about ---
  /** The topics a member listed, in order; none when they never saved any. */
  askMeAbout(memberId: string): Promise<string[]>;
  /** Saves the member's topics (creating their row), and who saved them. */
  saveAskMeAbout(memberId: string, topics: string[], updatedBy: string): Promise<void>;

  // --- private notes ---
  /** The author's note about one member, or null. */
  noteAbout(authorMemberId: string, subjectMemberId: string): Promise<MemberNote | null>;
  /** Every note the author wrote, as subject member id to body. Paginated. */
  notesBy(authorMemberId: string): Promise<Map<string, string>>;
  /** Saves (replacing) the author's note about a member and returns when it was saved. */
  saveNote(authorMemberId: string, subjectMemberId: string, body: string): Promise<string>;
  /** Removes the author's note about a member (nothing happens when there is none). */
  deleteNote(authorMemberId: string, subjectMemberId: string): Promise<void>;

  // --- roster ---
  /** Which of these members opted out of showing in "Who's coming". */
  rosterOptOuts(memberIds: string[]): Promise<Set<string>>;
  /** Shows the member in "Who's coming" again, or (false) hides them. Hiding twice is fine. */
  setRosterVisible(memberId: string, visible: boolean): Promise<void>;

  // --- Getting started tour ---
  /** The member's tour state, or null when they never started or changed it. */
  onboardingOf(memberId: string): Promise<OnboardingRecord | null>;
  /** Saves the given tour fields (creating the member's row), keeping the others, and stamps `updated_at`. */
  saveOnboarding(memberId: string, fields: OnboardingFields): Promise<void>;

  // --- Slack connection ---
  /** The member's connection (revoked ones included), or null. */
  slackConnectionOf(memberId: string): Promise<SlackConnection | null>;
  /** Whether a member other than this one has connected this Slack user. */
  slackUserConnectedByOther(slackUserId: string, memberId: string): Promise<boolean>;
  /** Slack user id to member id for every member who connected Slack, revoked ones included (the Slack id still belongs to them). Paginated. */
  slackUserLinks(): Promise<Map<string, string>>;
}

export class SupabaseMemberProfileRepository implements MemberProfileRepository {
  constructor(private readonly db: Db) {}

  async askMeAbout(memberId: string) {
    const { data, error } = await this.db.from("member_ask_me_about").select("topics").eq("member_id", memberId).maybeSingle();
    if (error) throw new Error(error.message);
    return data?.topics ?? [];
  }

  async saveAskMeAbout(memberId: string, topics: string[], updatedBy: string) {
    const { error } = await this.db.from("member_ask_me_about").upsert({ member_id: memberId, topics, updated_by: updatedBy }, { onConflict: "member_id" });
    if (error) throw new Error(error.message);
  }

  async noteAbout(authorMemberId: string, subjectMemberId: string) {
    const { data, error } = await this.db
      .from("member_notes")
      .select("body, updated_at")
      .eq("author_member_id", authorMemberId)
      .eq("subject_member_id", subjectMemberId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async notesBy(authorMemberId: string) {
    const rows = await fetchAllRows<Pick<Row<"member_notes">, "subject_member_id" | "body">>(
      (from, to) =>
        this.db
          .from("member_notes")
          .select("subject_member_id, body")
          .eq("author_member_id", authorMemberId)
          .order("subject_member_id")
          .range(from, to) as unknown as PromiseLike<Page<Pick<Row<"member_notes">, "subject_member_id" | "body">>>,
    );
    return new Map(rows.map((r) => [r.subject_member_id, r.body]));
  }

  async saveNote(authorMemberId: string, subjectMemberId: string, body: string) {
    const { data, error } = await this.db
      .from("member_notes")
      .upsert({ author_member_id: authorMemberId, subject_member_id: subjectMemberId, body }, { onConflict: "author_member_id,subject_member_id" })
      .select("updated_at")
      .single();
    if (error) throw new Error(error.message);
    return data.updated_at;
  }

  async deleteNote(authorMemberId: string, subjectMemberId: string) {
    const { error } = await this.db.from("member_notes").delete().eq("author_member_id", authorMemberId).eq("subject_member_id", subjectMemberId);
    if (error) throw new Error(error.message);
  }

  async rosterOptOuts(memberIds: string[]) {
    const rows = await inChunks(memberIds, ID_CHUNK_SIZE, async (ids) => {
      const { data, error } = await this.db.from("member_roster_opt_outs").select("member_id").in("member_id", ids);
      if (error) throw new Error(error.message);
      return data ?? [];
    });
    return new Set(rows.map((r) => r.member_id));
  }

  async setRosterVisible(memberId: string, visible: boolean) {
    const { error } = visible
      ? await this.db.from("member_roster_opt_outs").delete().eq("member_id", memberId)
      : await this.db.from("member_roster_opt_outs").upsert({ member_id: memberId }, { onConflict: "member_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }

  async onboardingOf(memberId: string) {
    const { data, error } = await this.db
      .from("member_onboarding")
      .select("marked_steps, dismissed_at, completed_at, acknowledged_steps")
      .eq("member_id", memberId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async saveOnboarding(memberId: string, fields: OnboardingFields) {
    const { error } = await this.db
      .from("member_onboarding")
      .upsert({ member_id: memberId, ...fields, updated_at: new Date().toISOString() }, { onConflict: "member_id" });
    if (error) throw new Error(error.message);
  }

  async slackConnectionOf(memberId: string) {
    const { data, error } = await this.db
      .from("member_slack_connections")
      .select("slack_user_id, connected_at, revoked_at, scopes")
      .eq("member_id", memberId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async slackUserConnectedByOther(slackUserId: string, memberId: string) {
    const { data, error } = await this.db
      .from("member_slack_connections")
      .select("member_id")
      .eq("slack_user_id", slackUserId)
      .neq("member_id", memberId)
      .limit(1);
    if (error) throw new Error(error.message);
    return (data?.length ?? 0) > 0;
  }

  async slackUserLinks() {
    const rows = await fetchAllRows<Pick<Row<"member_slack_connections">, "slack_user_id" | "member_id">>(
      (from, to) =>
        this.db.from("member_slack_connections").select("slack_user_id, member_id").order("member_id").range(from, to) as unknown as PromiseLike<
          Page<Pick<Row<"member_slack_connections">, "slack_user_id" | "member_id">>
        >,
    );
    return new Map(rows.map((r) => [r.slack_user_id, r.member_id]));
  }
}

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryMemberProfileRepository implements MemberProfileRepository {
  constructor(private readonly data: InMemoryDataset) {}

  private now() {
    return new Date().toISOString();
  }

  private requireMember(id: string) {
    if (!this.data.members.some((m) => m.id === id)) throw new Error("violates foreign key constraint on member_id");
  }

  async askMeAbout(memberId: string) {
    return [...(this.data.askMeAbout.find((a) => a.member_id === memberId)?.topics ?? [])];
  }

  async saveAskMeAbout(memberId: string, topics: string[], updatedBy: string) {
    this.requireMember(memberId);
    const existing = this.data.askMeAbout.find((a) => a.member_id === memberId);
    if (existing) Object.assign(existing, { topics: [...topics], updated_by: updatedBy, updated_at: this.now() });
    else this.data.askMeAbout.push({ member_id: memberId, topics: [...topics], updated_by: updatedBy, created_at: this.now(), updated_at: this.now() });
  }

  async noteAbout(authorMemberId: string, subjectMemberId: string) {
    const note = this.data.memberNotes.find((n) => n.author_member_id === authorMemberId && n.subject_member_id === subjectMemberId);
    return note ? { body: note.body, updated_at: note.updated_at } : null;
  }

  async notesBy(authorMemberId: string) {
    return new Map(this.data.memberNotes.filter((n) => n.author_member_id === authorMemberId).sort((a, b) => compareText(a.subject_member_id, b.subject_member_id)).map((n) => [n.subject_member_id, n.body]));
  }

  async saveNote(authorMemberId: string, subjectMemberId: string, body: string) {
    this.requireMember(authorMemberId);
    this.requireMember(subjectMemberId);
    const existing = this.data.memberNotes.find((n) => n.author_member_id === authorMemberId && n.subject_member_id === subjectMemberId);
    const now = this.now();
    if (existing) Object.assign(existing, { body, updated_at: now });
    else this.data.memberNotes.push({ author_member_id: authorMemberId, subject_member_id: subjectMemberId, body, created_at: now, updated_at: now });
    return now;
  }

  async deleteNote(authorMemberId: string, subjectMemberId: string) {
    this.data.memberNotes = this.data.memberNotes.filter((n) => !(n.author_member_id === authorMemberId && n.subject_member_id === subjectMemberId));
  }

  async rosterOptOuts(memberIds: string[]) {
    const wanted = new Set(memberIds);
    return new Set(this.data.rosterOptOuts.filter((r) => wanted.has(r.member_id)).map((r) => r.member_id));
  }

  async setRosterVisible(memberId: string, visible: boolean) {
    if (visible) {
      this.data.rosterOptOuts = this.data.rosterOptOuts.filter((r) => r.member_id !== memberId);
      return;
    }
    this.requireMember(memberId);
    if (!this.data.rosterOptOuts.some((r) => r.member_id === memberId)) this.data.rosterOptOuts.push({ member_id: memberId, created_at: this.now() });
  }

  async onboardingOf(memberId: string) {
    const row = this.data.onboarding.find((o) => o.member_id === memberId);
    return row
      ? { marked_steps: [...row.marked_steps], dismissed_at: row.dismissed_at, completed_at: row.completed_at, acknowledged_steps: row.acknowledged_steps && [...row.acknowledged_steps] }
      : null;
  }

  async saveOnboarding(memberId: string, fields: OnboardingFields) {
    this.requireMember(memberId);
    const defined = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as Update<"member_onboarding">;
    const existing = this.data.onboarding.find((o) => o.member_id === memberId);
    if (existing) {
      Object.assign(existing, defined, { updated_at: this.now() });
      return;
    }
    this.data.onboarding.push({
      member_id: memberId,
      marked_steps: [],
      dismissed_at: null,
      completed_at: null,
      acknowledged_steps: null,
      created_at: this.now(),
      ...defined,
      updated_at: this.now(),
    });
  }

  async slackConnectionOf(memberId: string) {
    const row = this.data.slackConnections.find((c) => c.member_id === memberId);
    return row ? { slack_user_id: row.slack_user_id, connected_at: row.connected_at, revoked_at: row.revoked_at, scopes: [...row.scopes] } : null;
  }

  async slackUserConnectedByOther(slackUserId: string, memberId: string) {
    return this.data.slackConnections.some((c) => c.slack_user_id === slackUserId && c.member_id !== memberId);
  }

  async slackUserLinks() {
    return new Map(this.data.slackConnections.map((c) => [c.slack_user_id, c.member_id]));
  }
}
