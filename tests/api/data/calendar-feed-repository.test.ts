import { afterAll, beforeAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseCalendarFeedRepository } from "@/lib/data/calendar-feed";
import { defineCalendarFeedContract } from "@/tests/helpers/calendar-feed-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `${Date.now()}`;
let members: [string, string];
let types: { id: string; name: string }[];
let prickles: { id: string; typeId: string; startTime: string }[];
let events: { id: string; title: string; startsAt: string; endsAt: string }[];

async function clear() {
  for (const table of ["calendar_feed_items", "calendar_feed_tokens"] as const) {
    const { error } = await db.from(table).delete().in("member_id", members);
    if (error) throw new Error(error.message);
  }
}

beforeAll(async () => {
  const { data: memberRows, error: memberError } = await db
    .from("members")
    .insert([0, 1].map((i) => ({ name: `Feed Repo ${i} ${RUN}`, email: `feed-repo-${RUN}-${i}@example.com`, joined_at: "2026-01-01", status: "active" })))
    .select("id, email");
  if (memberError) throw new Error(memberError.message);
  members = [0, 1].map((i) => memberRows!.find((m) => m.email === `feed-repo-${RUN}-${i}@example.com`)!.id) as [string, string];

  const { data: typeRows, error: typeError } = await db
    .from("prickle_types")
    .insert([0, 1].map((i) => ({ name: `Feed Contract ${i} ${RUN}`, normalized_name: `feed-contract-${i}-${RUN}`, purpose: "writing" })))
    .select("id, name");
  if (typeError) throw new Error(typeError.message);
  types = [0, 1].map((i) => typeRows!.find((t) => t.name === `Feed Contract ${i} ${RUN}`)!);

  const startOf = (i: number) => new Date(Date.UTC(2097, 5, 1, 9 + i)).toISOString();
  const { data: prickleRows, error: prickleError } = await db
    .from("prickles")
    .insert([0, 1].map((i) => ({ type_id: types[i].id, start_time: startOf(i), end_time: new Date(Date.parse(startOf(i)) + 3_600_000).toISOString(), source: "calendar" })))
    .select("id, type_id, start_time");
  if (prickleError) throw new Error(prickleError.message);
  prickles = [0, 1].map((i) => {
    const row = prickleRows!.find((p) => p.type_id === types[i].id)!;
    return { id: row.id, typeId: row.type_id!, startTime: row.start_time };
  });

  const specs = [0, 1].map((i) => ({
    title: `Feed Contract Event ${i} ${RUN}`,
    slug: `feed-contract-${i}-${RUN}`,
    event_type: "other",
    starts_at: `2097-0${4 + i}-10`,
    ends_at: `2097-0${4 + i}-12`,
  }));
  const { data: eventRows, error: eventError } = await db.from("events").insert(specs).select("id, title, starts_at, ends_at");
  if (eventError) throw new Error(eventError.message);
  events = specs.map((spec) => {
    const row = eventRows!.find((e) => e.title === spec.title)!;
    return { id: row.id, title: row.title, startsAt: row.starts_at, endsAt: row.ends_at };
  });
});

afterAll(async () => {
  await clear();
  await db.from("events").delete().in("id", events.map((e) => e.id));
  await db.from("prickles").delete().in("id", prickles.map((p) => p.id));
  await db.from("prickle_types").delete().in("id", types.map((t) => t.id));
  await db.from("members").delete().in("id", members);
});

defineCalendarFeedContract("SupabaseCalendarFeedRepository", () => ({
  repo: () => new SupabaseCalendarFeedRepository(db),
  get members() {
    return members;
  },
  get types() {
    return [types[0], types[1]] as [{ id: string; name: string }, { id: string; name: string }];
  },
  get prickles() {
    return [prickles[0], prickles[1]] as [(typeof prickles)[number], (typeof prickles)[number]];
  },
  get events() {
    return [events[0], events[1]] as [(typeof events)[number], (typeof events)[number]];
  },
  reset: clear,
}));
