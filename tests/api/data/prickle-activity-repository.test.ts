import { afterAll, beforeAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabasePrickleActivityRepository } from "@/lib/data/prickle-activity";
import { definePrickleActivityContract } from "@/tests/helpers/prickle-activity-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `${Date.now()}`;
let members: [string, string];
let types: { id: string; name: string }[];
let prickles: { id: string; typeId: string; hostId: string | null }[];

async function clear() {
  for (const table of ["prickle_commitments", "prickle_checkins", "prickle_checkin_dismissals", "prickle_checkout_dismissals", "prickle_checkin_dm_log"] as const) {
    const { error } = await db.from(table).delete().in("member_id", members);
    if (error) throw new Error(error.message);
  }
}

beforeAll(async () => {
  const { data: memberRows, error: memberError } = await db
    .from("members")
    .insert([0, 1].map((i) => ({ name: `Activity Repo ${i} ${RUN}`, email: `activity-repo-${RUN}-${i}@example.com`, joined_at: "2026-01-01", status: "active" })))
    .select("id, email");
  if (memberError) throw new Error(memberError.message);
  members = [0, 1].map((i) => memberRows!.find((m) => m.email === `activity-repo-${RUN}-${i}@example.com`)!.id) as [string, string];

  const { data: typeRows, error: typeError } = await db
    .from("prickle_types")
    .insert([0, 1].map((i) => ({ name: `Activity Contract ${i} ${RUN}`, normalized_name: `activity-contract-${i}-${RUN}`, purpose: "writing" })))
    .select("id, name");
  if (typeError) throw new Error(typeError.message);
  types = [0, 1].map((i) => typeRows!.find((t) => t.name === `Activity Contract ${i} ${RUN}`)!);

  const specs = [
    { type: types[0].id, host: members[1] },
    { type: types[1].id, host: null },
    { type: types[0].id, host: null },
  ];
  const startOf = (i: number) => new Date(Date.UTC(2097, 5, 1, 9 + i)).toISOString();
  const { data: prickleRows, error: prickleError } = await db
    .from("prickles")
    .insert(specs.map((p, i) => ({ type_id: p.type, host: p.host, start_time: startOf(i), end_time: new Date(Date.parse(startOf(i)) + 3_600_000).toISOString(), source: "calendar" })))
    .select("id, start_time");
  if (prickleError) throw new Error(prickleError.message);
  const sorted = [...prickleRows!].sort((a, b) => a.start_time.localeCompare(b.start_time));
  prickles = sorted.map((p, i) => ({ id: p.id, typeId: specs[i].type, hostId: specs[i].host }));
});

afterAll(async () => {
  await clear();
  await db.from("prickles").delete().in("id", prickles.map((p) => p.id));
  await db.from("prickle_types").delete().in("id", types.map((t) => t.id));
  await db.from("members").delete().in("id", members);
});

definePrickleActivityContract("SupabasePrickleActivityRepository", () => ({
  repo: () => new SupabasePrickleActivityRepository(db),
  get members() {
    return members;
  },
  get types() {
    return [types[0], types[1]] as [{ id: string; name: string }, { id: string; name: string }];
  },
  get prickles() {
    return [prickles[0], prickles[1], prickles[2]] as [(typeof prickles)[number], (typeof prickles)[number], (typeof prickles)[number]];
  },
  reset: clear,
}));
