import { afterAll, beforeAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseBadgeRepository } from "@/lib/data/badges";
import { defineBadgeContract } from "@/tests/helpers/badge-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `${Date.now()}`;
let memberIds: [string, string];
let events: [{ id: string; title: string; slug: string }, { id: string; title: string; slug: string }];
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

  const evs = await db
    .from("events")
    .insert([0, 1].map((i) => ({ title: `Badge Event ${i} ${RUN}`, slug: `badge-event-${i}-${RUN}`, starts_at: "2097-03-01T10:00:00Z", ends_at: "2097-03-02T10:00:00Z", event_type: "other" })))
    .select("id, title, slug");
  if (evs.error) throw new Error(evs.error.message);
  events = [evs.data![0], evs.data![1]];
});

afterAll(async () => {
  await removeCreated();
  await db.from("member_badges").delete().in("member_id", memberIds);
  await db.from("events").delete().in("id", events.map((e) => e.id));
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
