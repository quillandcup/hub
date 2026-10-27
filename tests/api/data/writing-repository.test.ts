import { afterAll, beforeAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseWritingRepository } from "@/lib/data/writing";
import { defineWritingContract } from "@/tests/helpers/writing-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `${Date.now()}`;
let memberIds: [string, string];
let typeId: string;
let prickleId: string;

const clear = async () => {
  // Entries and project goals go with their projects (ON DELETE CASCADE); project-less goals don't.
  const { error: goalError } = await db.from("writing_goals").delete().in("member_id", memberIds);
  if (goalError) throw new Error(goalError.message);
  const { error } = await db.from("writing_projects").delete().in("member_id", memberIds);
  if (error) throw new Error(error.message);
};

beforeAll(async () => {
  const { data, error } = await db
    .from("members")
    .insert([0, 1].map((i) => ({ name: `Writing Member ${i} ${RUN}`, email: `writing-repo-${RUN}-${i}@example.com`, joined_at: "2026-01-01", status: "active" })))
    .select("id, email");
  if (error) throw new Error(error.message);
  memberIds = [0, 1].map((i) => data!.find((m) => m.email === `writing-repo-${RUN}-${i}@example.com`)!.id) as [string, string];

  const { data: type, error: typeError } = await db
    .from("prickle_types")
    .insert({ name: `Writing Contract ${RUN}`, normalized_name: `writing-contract-${RUN}`, purpose: "writing" })
    .select("id")
    .single();
  if (typeError) throw new Error(typeError.message);
  typeId = type.id;
  const { data: prickle, error: prickleError } = await db
    .from("prickles")
    .insert({ type_id: typeId, host: memberIds[1], start_time: "2097-01-01T09:00:00Z", end_time: "2097-01-01T10:00:00Z", source: "calendar" })
    .select("id")
    .single();
  if (prickleError) throw new Error(prickleError.message);
  prickleId = prickle.id;
});

afterAll(async () => {
  await clear();
  await db.from("prickles").delete().eq("id", prickleId);
  await db.from("prickle_types").delete().eq("id", typeId);
  await db.from("members").delete().in("id", memberIds);
});

defineWritingContract("SupabaseWritingRepository", () => ({
  get memberIds() {
    return memberIds;
  },
  get prickleId() {
    return prickleId;
  },
  get prickleTypeName() {
    return `Writing Contract ${RUN}`;
  },
  get prickleHostName() {
    return `Writing Member 1 ${RUN}`;
  },
  repo: () => new SupabaseWritingRepository(db),
  seed: async ({ projects = [], goals = [], entries = [] }) => {
    await clear();
    const ids: Record<string, string> = {};
    for (const p of projects) {
      const { data, error } = await db
        .from("writing_projects")
        .insert({ member_id: memberIds[p.member], title: p.title, archived_at: p.archived ? "2026-06-01T00:00:00Z" : null, created_at: p.createdAt })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      ids[p.key] = data.id;
    }
    if (goals.length > 0) {
      const { error } = await db
        .from("writing_goals")
        .insert(goals.map((g) => ({ member_id: memberIds[g.member], project_id: g.project ? ids[g.project] : null, measure: g.measure, target_amount: 1000, archived_at: g.archived ? "2026-06-01T00:00:00Z" : null })));
      if (error) throw new Error(error.message);
    }
    if (entries.length > 0) {
      const { error } = await db.from("writing_progress_entries").insert(
        entries.map((e) => ({
          member_id: memberIds[e.member],
          project_id: ids[e.project],
          prickle_id: e.prickle ? prickleId : null,
          entry_date: e.entryDate,
          measure: e.measure,
          mode: e.mode,
          amount: e.amount,
          note: e.note ?? null,
          tags: e.tags ?? [],
          created_at: e.createdAt,
        })),
      );
      if (error) throw new Error(error.message);
    }
    return ids;
  },
}));
