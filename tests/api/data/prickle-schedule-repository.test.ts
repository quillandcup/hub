import { afterAll, beforeAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabasePrickleScheduleRepository } from "@/lib/data/prickle-schedules";
import { definePrickleScheduleContract, type SeedSchedule } from "@/tests/helpers/prickle-schedule-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `${Date.now()}`;
// Months far in the future, picked per run so other tests' schedules never show up in a month listing.
const year = 3000 + (Date.now() % 6000);
const months = [`${year}-03-01`, `${year}-04-01`, `${year}-05-01`] as const;
let memberIds: [string, string];
let typeIds: [string, string];

const clear = async () => {
  const { error } = await db.from("prickle_schedules").delete().in("host_id", memberIds);
  if (error) throw new Error(error.message);
};

beforeAll(async () => {
  const { data, error } = await db
    .from("members")
    .insert([0, 1].map((i) => ({ name: `${i === 0 ? "Ada" : "Bo"} Example ${RUN}`, display_name: i === 0 ? "Ada E." : null, email: `schedule-repo-${RUN}-${i}@example.com`, joined_at: "2026-01-01", status: "active" })))
    .select("id, email");
  if (error) throw new Error(error.message);
  memberIds = [0, 1].map((i) => data!.find((m) => m.email === `schedule-repo-${RUN}-${i}@example.com`)!.id) as [string, string];

  const { data: types, error: typeError } = await db
    .from("prickle_types")
    .insert([0, 1].map((i) => ({ name: `Sprint ${"AB"[i]} ${RUN}`, normalized_name: `schedule-repo-${"ab"[i]}-${RUN}`, purpose: "writing", requires_host: true })))
    .select("id, name");
  if (typeError) throw new Error(typeError.message);
  typeIds = [0, 1].map((i) => types!.find((t) => t.name === `Sprint ${"AB"[i]} ${RUN}`)!.id) as [string, string];
});

afterAll(async () => {
  await clear();
  await db.from("prickle_types").delete().in("id", typeIds);
  await db.from("members").delete().in("id", memberIds);
});

definePrickleScheduleContract("SupabasePrickleScheduleRepository", () => ({
  get memberIds() {
    return memberIds;
  },
  get typeIds() {
    return typeIds;
  },
  get typeNames() {
    return [`Sprint A ${RUN}`, `Sprint B ${RUN}`] as const;
  },
  months,
  missingId: "00000000-0000-4000-8000-000000000000",
  repo: () => new SupabasePrickleScheduleRepository(db),
  stored: async () => {
    const { data, error } = await db.from("prickle_schedules").select("*").in("host_id", memberIds).order("created_at").order("id");
    if (error) throw new Error(error.message);
    return (data ?? []) as never;
  },
  seed: async (rows: SeedSchedule[]) => {
    await clear();
    const ids: Record<string, string> = {};
    if (rows.length === 0) return ids;
    const { data, error } = await db
      .from("prickle_schedules")
      .insert(
        rows.map((r) => ({
          host_id: memberIds[r.host],
          type_id: typeIds[r.type ?? 0],
          month: months[r.month],
          recurrence_type: r.recurrence ?? "weekly",
          day_of_week: r.recurrence === "one_off" ? null : 2,
          event_date: r.recurrence === "one_off" ? `${months[r.month].slice(0, 8)}15` : null,
          start_time_local: "19:00",
          status: r.status ?? "proposed",
          deleted_at: r.deleted ? "2099-01-01T00:00:00Z" : null,
          created_at: new Date(Date.UTC(2090, 0, 1, 0, 0, r.created)).toISOString(),
          notes: r.key,
        })),
      )
      .select("id, notes");
    if (error) throw new Error(error.message);
    for (const row of data!) ids[row.notes!] = row.id;
    // The key was only a marker to find each row's id.
    const { error: noteError } = await db.from("prickle_schedules").update({ notes: null }).in("id", Object.values(ids));
    if (noteError) throw new Error(noteError.message);
    return ids;
  },
}));
