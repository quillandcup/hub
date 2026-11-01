import { afterAll, beforeAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseBadgeRepository } from "@/lib/data/badges";
import { defineBadgeContract } from "@/tests/helpers/badge-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `${Date.now()}`;
let memberIds: [string, string];
let events: [{ id: string; title: string; slug: string }, { id: string; title: string; slug: string }];
let prickleIds: string[] = [];
const createdTypes: string[] = [];
const createdAwards: string[] = [];
let counter = 0;

async function removeCreated() {
  if (createdAwards.length) await db.from("member_badges").delete().in("id", createdAwards.splice(0));
  if (createdTypes.length) await db.from("badge_types").delete().in("id", createdTypes.splice(0));
}

beforeAll(async () => {
  const members = await db
    .from("members")
    .insert([0, 1].map((i) => ({ name: `Badge Member ${i} ${RUN}`, email: `badge-repo-${RUN}-${i}@example.com`, joined_at: "2026-01-01", status: "active" })))
    .select("id");
  if (members.error) throw new Error(members.error.message);
  memberIds = [members.data![0].id, members.data![1].id];

  const type = await db.from("prickle_types").select("id").eq("normalized_name", "event").single();
  if (type.error) throw new Error(type.error.message);
  const prickles = await db
    .from("prickles")
    .insert([0, 1].map((i) => ({ source: "calendar", type_id: type.data.id, title: `Badge Event ${i} ${RUN}`, start_time: "2097-03-01T10:00:00Z", end_time: "2097-03-02T10:00:00Z" })))
    .select("id, title");
  if (prickles.error) throw new Error(prickles.error.message);
  prickleIds = prickles.data!.map((p) => p.id);
  const evs = await db
    .from("community_events")
    .insert(prickles.data!.map((p, i) => ({ prickle_id: p.id, slug: `badge-event-${i}-${RUN}`, event_type: "other" })))
    .select("id, slug, prickle_id");
  if (evs.error) throw new Error(evs.error.message);
  events = [0, 1].map((i) => ({ id: evs.data![i].id, slug: evs.data![i].slug, title: prickles.data!.find((p) => p.id === evs.data![i].prickle_id)!.title! })) as unknown as typeof events;
});

afterAll(async () => {
  await removeCreated();
  await db.from("member_badges").delete().in("member_id", memberIds);
  await db.from("community_events").delete().in("id", events.map((e) => e.id));
  await db.from("prickles").delete().in("id", prickleIds);
  await db.from("members").delete().in("id", memberIds);
});

defineBadgeContract("SupabaseBadgeRepository", () => ({
  get memberIds() {
    return memberIds;
  },
  get events() {
    return events;
  },
  repo: () => new SupabaseBadgeRepository(db),
  unique: (label) => `${label} ${RUN} ${++counter}`,
  adopt: ({ typeIds = [], awardIds = [] }) => {
    createdTypes.push(...typeIds);
    createdAwards.push(...awardIds);
  },
  reset: removeCreated,
}));
