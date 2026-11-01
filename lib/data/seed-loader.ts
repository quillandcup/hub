import type { Db, Insert } from "./db";
import type { InMemoryDataset } from "./in-memory";
import { asJson } from "./json";

/**
 * Writes a built seed profile (`buildDataset`) into a real database, for local development and
 * tests that need the profile's people in Postgres. It is the only place that does, so the same
 * profile that feeds the in-memory twin feeds the database.
 *
 * Safe by construction:
 * - Only a local database. `assertSeedTarget` refuses any other URL unless `SEED_ALLOW_NON_LOCAL_DATABASE=1`
 *   is set on purpose.
 * - Everything it writes is marked with the profile's name (members: `raw_payload.seed_profile`;
 *   prickles: the legacy `type` column, which no code reads), so a re-run first deletes what the
 *   previous run wrote (dates move with `now`, so ids differ between runs) and a test can remove
 *   only its own rows. Attendance, badges, notifications and matches go with their member or
 *   prickle through the foreign keys.
 * - Shared reference rows are never rewritten or deleted: prickle types and badge types are matched
 *   to the ones already in the database by name or `normalized_name` / badge `key`, and only missing ones are added.
 * - Writes are chunked.
 */

const CHUNK = 500;
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** The flag that allows a non-local target. */
export const SEED_NON_LOCAL_FLAG = "SEED_ALLOW_NON_LOCAL_DATABASE";

/** Throws unless `url` is a local Supabase (or the flag is set to "1"). */
export function assertSeedTarget(url: string | undefined, env: Record<string, string | undefined> = process.env): void {
  if (!url) throw new Error("No Supabase URL to seed: refusing to guess one.");
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new Error(`"${url}" is not a URL: refusing to seed it.`);
  }
  if (LOCAL_HOSTS.has(hostname) || env[SEED_NON_LOCAL_FLAG] === "1") return;
  throw new Error(`Refusing to seed ${hostname}: seed profiles only load into a local database (set ${SEED_NON_LOCAL_FLAG}=1 to override on purpose).`);
}

export interface LoadOptions {
  /** The profile's name: marks every row written so a re-run or a test can remove exactly them. */
  profile: string;
  /** Supabase Auth user per member email, for the people who sign in (members' `user_id`). */
  userIdByEmail?: Map<string, string>;
  /**
   * What to write besides the members, who are always written. All of it when not given. The demo stack
   * leaves out the prickles and attendance because it derives those from its Bronze calendar and Zoom rows
   * with the app's own processing, the way production does.
   */
  include?: LoadPart[];
}

export type LoadPart = "prickles" | "attendance" | "badges" | "notifications" | "mentorships";
export const LOAD_PARTS: readonly LoadPart[] = ["prickles", "attendance", "badges", "notifications", "mentorships"];

export interface LoadResult {
  members: number;
  prickles: number;
  attendance: number;
  badges: number;
  notifications: number;
  mentorships: number;
}

function check(table: string, error: { message: string } | null) {
  if (error) throw new Error(`seed ${table}: ${error.message}`);
}

async function insertChunked<T>(rows: T[], insert: (chunk: T[]) => PromiseLike<{ error: { message: string } | null }>, table: string) {
  for (let i = 0; i < rows.length; i += CHUNK) check(table, (await insert(rows.slice(i, i + CHUNK))).error);
}

/** Removes the rows a previous load of `profile` wrote (and what hangs off them). Reference rows stay. */
export async function clearProfile(db: Db, profile: string): Promise<void> {
  check("prickles clear", (await db.from("prickles").delete().eq("type", seedMarker(profile))).error);
  check("members clear", (await db.from("members").delete().eq("raw_payload->>seed_profile", profile)).error);
}

const seedMarker = (profile: string) => `seed:${profile}`;

/** Loads `dataset` (from `buildDataset`) into `db`, replacing an earlier load of the same profile. */
export async function loadProfile(db: Db, dataset: InMemoryDataset, { profile, userIdByEmail, include = [...LOAD_PARTS] }: LoadOptions): Promise<LoadResult> {
  const parts = new Set(include);
  if (parts.has("attendance") && !parts.has("prickles")) throw new Error("seed: attendance needs the prickles it was at: include both or neither.");
  const pick = <T>(part: LoadPart, rows: T[]): T[] => (parts.has(part) ? rows : []);
  await clearProfile(db, profile);

  // The same address held by another seed profile's person: that profile is replaced (one at a time).
  // Held by anyone else (a hand-made or demo-seeded member): stop.
  const emails = dataset.members.flatMap((m) => (m.email ? [m.email] : []));
  const otherProfiles = new Set<string>();
  for (let i = 0; i < emails.length; i += CHUNK) {
    const { data, error } = await db.from("members").select("email, raw_payload").in("email", emails.slice(i, i + CHUNK));
    check("members lookup", error);
    const strangers = (data ?? []).filter((m) => {
      const owner = (m.raw_payload as { seed_profile?: unknown } | null)?.seed_profile;
      if (typeof owner === "string") otherProfiles.add(owner);
      return typeof owner !== "string";
    });
    if (strangers.length > 0) {
      throw new Error(`seed members: ${strangers.length} address(es) such as ${strangers[0].email} already belong to members no seed profile wrote; remove them or pick another profile.`);
    }
  }
  for (const other of otherProfiles) await clearProfile(db, other);

  // Reference rows: reuse what the database has, add what it lacks.
  const typeIds = new Map<string, string>();
  const { data: existingTypes, error: typesError } = await db.from("prickle_types").select("id, name, normalized_name");
  check("prickle_types lookup", typesError);
  const typeByName = new Map((existingTypes ?? []).flatMap((t) => [[t.normalized_name, t.id] as const, [t.name, t.id] as const]));
  const newTypes: Insert<"prickle_types">[] = [];
  for (const t of pick("prickles", dataset.prickleTypes)) {
    const existing = typeByName.get(t.normalizedName) ?? typeByName.get(t.name);
    typeIds.set(t.id, existing ?? t.id);
    if (!existing) {
      newTypes.push({ id: t.id, name: t.name, normalized_name: t.normalizedName, purpose: t.purpose, requires_host: t.requiresHost, solo_task_friendly: t.soloTaskFriendly });
    }
  }
  await insertChunked(newTypes, (rows) => db.from("prickle_types").insert(rows), "prickle_types");

  const badgeIds = new Map<string, string>();
  const { data: existingBadges, error: badgesError } = await db.from("badge_types").select("id, key");
  check("badge_types lookup", badgesError);
  const badgeByKey = new Map((existingBadges ?? []).map((b) => [b.key, b.id]));
  const newBadges: Insert<"badge_types">[] = [];
  for (const b of pick("badges", dataset.badgeTypes)) {
    const existing = badgeByKey.get(b.key);
    badgeIds.set(b.id, existing ?? b.id);
    if (!existing) newBadges.push({ id: b.id, key: b.key, name: b.name, icon: b.icon, category: b.category, has_levels: b.has_levels, is_automatic: b.is_automatic });
  }
  await insertChunked(newBadges, (rows) => db.from("badge_types").insert(rows), "badge_types");

  // The people, then what points at them.
  const members: Insert<"members">[] = dataset.members.map((m) => ({
    id: m.id,
    name: m.name,
    display_name: m.displayName ?? null,
    email: m.email as string,
    status: m.status ?? "active",
    source: m.source ?? "kajabi",
    bio: m.bio ?? null,
    joined_at: m.joinedAt ?? new Date().toISOString().slice(0, 10),
    user_id: userIdByEmail?.get(m.email as string) ?? null,
    raw_payload: asJson({ seed_profile: profile }),
  }));
  await insertChunked(members, (rows) => db.from("members").insert(rows), "members");

  const prickles: Insert<"prickles">[] = pick("prickles", dataset.prickles).map((p) => ({
    id: p.id,
    type_id: p.typeId ? (typeIds.get(p.typeId) ?? p.typeId) : null,
    host: p.hostId,
    title: p.title,
    start_time: p.startTime,
    end_time: p.endTime,
    source: p.source,
    type: seedMarker(profile),
  }));
  await insertChunked(prickles, (rows) => db.from("prickles").insert(rows), "prickles");

  const attendance: Insert<"prickle_attendance">[] = pick("attendance", dataset.attendance).map((a) => ({
    member_id: a.memberId,
    prickle_id: a.prickleId,
    join_time: a.joinTime,
    leave_time: a.leaveTime,
    confidence_score: a.confidenceScore ?? "high",
  }));
  await insertChunked(attendance, (rows) => db.from("prickle_attendance").insert(rows), "prickle_attendance");

  const memberBadges: Insert<"member_badges">[] = pick("badges", dataset.memberBadges).map((b) => ({
    member_id: b.memberId,
    badge_type_id: badgeIds.get(b.badgeTypeId) ?? b.badgeTypeId,
    occurred_at: b.occurredAt,
    note: b.note,
  }));
  await insertChunked(memberBadges, (rows) => db.from("member_badges").insert(rows), "member_badges");

  const notifications: Insert<"in_app_notifications">[] = pick("notifications", dataset.inAppNotifications).map((n) => ({
    member_id: n.memberId,
    kind: n.kind,
    ref: n.ref,
    text: n.text,
    url: n.url,
    banner_until: n.bannerUntil,
    read_at: n.readAt,
    created_at: n.createdAt,
  }));
  await insertChunked(notifications, (rows) => db.from("in_app_notifications").insert(rows), "in_app_notifications");

  // Attendance, member badges, notifications and matches still have uuid ids (phase 2 of docs/SHORT_IDS_PLAN.md): the database picks them.
  const matches: Insert<"mentorships">[] = pick("mentorships", dataset.mentorships).map(({ id: _id, ...match }) => match);
  await insertChunked(matches, (rows) => db.from("mentorships").insert(rows), "mentorships");

  return {
    members: members.length,
    prickles: prickles.length,
    attendance: attendance.length,
    badges: memberBadges.length,
    notifications: notifications.length,
    mentorships: matches.length,
  };
}
