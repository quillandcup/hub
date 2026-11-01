import type { Db, Row } from "./db";
import type { InMemoryDataset } from "./in-memory";

/** A match the Wheel of Wonder made (`wheel_of_wonder_matches`): a spinner, who they were matched with, and the Slack room made for them. */
export type WheelMatchRow = Row<"wheel_of_wonder_matches">;

/** What a new match needs; the counts start at zero and the status at "proposed". */
export type NewWheelMatch = {
  spinnerMemberId: string;
  matchedMemberId: string;
  slackChannelId: string;
  spinnerSlackUserId: string | null;
  matchedSlackUserId: string | null;
};

/** The match fields the Slack webhook reads to count a message in a room. */
export type ProposedWheelMatch = Pick<
  WheelMatchRow,
  "id" | "spinner_member_id" | "matched_member_id" | "spinner_slack_user_id" | "matched_slack_user_id" | "spinner_message_count" | "matched_message_count"
>;

/** A change to a match's message counts, and, when it has become a real connection, its confirmation. */
export type WheelMatchExchange = {
  spinnerMessageCount: number;
  matchedMessageCount: number;
  /** Set when the connection is confirmed: when, and the member whose message confirmed it. */
  confirmed?: { at: string; byMemberId: string };
};

/** A match for the admin list, with the two members' names joined in. */
export type WheelMatchSummary = Pick<WheelMatchRow, "id" | "status" | "created_at" | "confirmed_at" | "spinner_message_count" | "matched_message_count"> & {
  spinner: { id: string; name: string } | null;
  matched: { id: string; name: string } | null;
};

const SUMMARY_SELECT = `
  id,
  status,
  created_at,
  confirmed_at,
  spinner_message_count,
  matched_message_count,
  spinner:members!spinner_member_id(id, name),
  matched:members!matched_member_id(id, name)
`;

const PROPOSED_COLUMNS = "id, spinner_member_id, matched_member_id, spinner_slack_user_id, matched_slack_user_id, spinner_message_count, matched_message_count";

/**
 * The Wheel of Wonder's matches. A spin that opens a Slack room records a "proposed" match; the Slack
 * webhook counts each side's messages in that room and confirms the match once both have spoken enough.
 * Methods throw on a database error.
 */
export interface WheelOfWonderRepository {
  /** Records a proposed match for the room just made. */
  recordProposed(match: NewWheelMatch): Promise<void>;
  /** The proposed match whose Slack room is this channel, or null when the channel is not one (or its match is already confirmed). */
  proposedInChannel(slackChannelId: string): Promise<ProposedWheelMatch | null>;
  /** Saves a match's new message counts and, if given, confirms it. */
  recordExchange(matchId: string, exchange: WheelMatchExchange): Promise<void>;
  /** How many matches have been confirmed. */
  confirmedCount(): Promise<number>;
  /** The newest matches first, at most `limit` (one page: keep it to 1000 or less), with the names of the two members. */
  recent(limit: number): Promise<WheelMatchSummary[]>;
}

export class SupabaseWheelOfWonderRepository implements WheelOfWonderRepository {
  constructor(private readonly db: Db) {}

  async recordProposed(match: NewWheelMatch) {
    const { error } = await this.db.from("wheel_of_wonder_matches").insert({
      spinner_member_id: match.spinnerMemberId,
      matched_member_id: match.matchedMemberId,
      slack_channel_id: match.slackChannelId,
      spinner_slack_user_id: match.spinnerSlackUserId,
      matched_slack_user_id: match.matchedSlackUserId,
      status: "proposed",
    });
    if (error) throw new Error(error.message);
  }

  async proposedInChannel(slackChannelId: string) {
    const { data, error } = await this.db
      .from("wheel_of_wonder_matches")
      .select(PROPOSED_COLUMNS)
      .eq("slack_channel_id", slackChannelId)
      .eq("status", "proposed")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ?? null;
  }

  async recordExchange(matchId: string, { spinnerMessageCount, matchedMessageCount, confirmed }: WheelMatchExchange) {
    const { error } = await this.db
      .from("wheel_of_wonder_matches")
      .update({
        spinner_message_count: spinnerMessageCount,
        matched_message_count: matchedMessageCount,
        ...(confirmed ? { status: "confirmed", confirmed_at: confirmed.at, confirmed_by_member_id: confirmed.byMemberId } : {}),
      })
      .eq("id", matchId);
    if (error) throw new Error(error.message);
  }

  async confirmedCount() {
    const { count, error } = await this.db.from("wheel_of_wonder_matches").select("*", { count: "exact", head: true }).eq("status", "confirmed");
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async recent(limit: number) {
    // PostgREST returns a to-one embed as an object, though the generated type allows an array: normalise.
    type Embed = WheelMatchSummary["spinner"];
    type Raw = Omit<WheelMatchSummary, "spinner" | "matched"> & { spinner: Embed | Embed[]; matched: Embed | Embed[] };
    const one = (value: Embed | Embed[]): Embed => (Array.isArray(value) ? (value[0] ?? null) : value);
    const { data, error } = await this.db
      .from("wheel_of_wonder_matches")
      .select(SUMMARY_SELECT)
      .order("created_at", { ascending: false })
      .order("id")
      .limit(limit);
    if (error) throw new Error(error.message);
    const rows = (data ?? []);
    return rows.map((row) => ({ ...row, spinner: one(row.spinner), matched: one(row.matched) }));
  }
}

/** In-memory twin over an `InMemoryDataset`, joining the member names from its members. */
export class InMemoryWheelOfWonderRepository implements WheelOfWonderRepository {
  constructor(private readonly data: InMemoryDataset) {}

  async recordProposed(match: NewWheelMatch) {
    this.data.wheelMatches.push({
      id: crypto.randomUUID(),
      spinner_member_id: match.spinnerMemberId,
      matched_member_id: match.matchedMemberId,
      slack_channel_id: match.slackChannelId,
      spinner_slack_user_id: match.spinnerSlackUserId,
      matched_slack_user_id: match.matchedSlackUserId,
      status: "proposed",
      spinner_message_count: 0,
      matched_message_count: 0,
      // Rising, like the database's now(), so two matches recorded in a row keep their order.
      created_at: new Date(Math.max(Date.now(), ...this.data.wheelMatches.map((m) => Date.parse(m.created_at) + 1))).toISOString(),
      confirmed_at: null,
      confirmed_by_member_id: null,
    });
  }

  async proposedInChannel(slackChannelId: string) {
    const found = this.data.wheelMatches.filter((m) => m.slack_channel_id === slackChannelId && m.status === "proposed");
    if (found.length > 1) throw new Error("JSON object requested, multiple (or no) rows returned");
    const m = found[0];
    return m
      ? {
          id: m.id,
          spinner_member_id: m.spinner_member_id,
          matched_member_id: m.matched_member_id,
          spinner_slack_user_id: m.spinner_slack_user_id,
          matched_slack_user_id: m.matched_slack_user_id,
          spinner_message_count: m.spinner_message_count,
          matched_message_count: m.matched_message_count,
        }
      : null;
  }

  async recordExchange(matchId: string, { spinnerMessageCount, matchedMessageCount, confirmed }: WheelMatchExchange) {
    const m = this.data.wheelMatches.find((x) => x.id === matchId);
    if (!m) return;
    m.spinner_message_count = spinnerMessageCount;
    m.matched_message_count = matchedMessageCount;
    if (confirmed) Object.assign(m, { status: "confirmed", confirmed_at: confirmed.at, confirmed_by_member_id: confirmed.byMemberId });
  }

  async confirmedCount() {
    return this.data.wheelMatches.filter((m) => m.status === "confirmed").length;
  }

  async recent(limit: number) {
    const named = (id: string) => {
      const member = this.data.members.find((m) => m.id === id);
      return member ? { id: member.id, name: member.name } : null;
    };
    return [...this.data.wheelMatches]
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? -1 : 1))
      .slice(0, limit)
      .map((m) => ({
        id: m.id,
        status: m.status,
        created_at: m.created_at,
        confirmed_at: m.confirmed_at,
        spinner_message_count: m.spinner_message_count,
        matched_message_count: m.matched_message_count,
        spinner: named(m.spinner_member_id),
        matched: named(m.matched_member_id),
      }));
  }
}
