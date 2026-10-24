import { afterAll, beforeAll } from "vitest";
import { SupabaseAttendanceRepository } from "@/lib/data/attendance";
import type { Db } from "@/lib/data/db";
import { defineAttendanceContract, type SeedRecord } from "@/tests/helpers/attendance-contract";
import { seedReferenceData } from "@/tests/helpers/seed-data";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `${Date.now()}`;
let memberIds: [string, string, string];
let prickleIds: [string, string, string];

async function clearAttendance() {
  const { error } = await db.from("prickle_attendance").delete().in("member_id", memberIds);
  if (error) throw new Error(error.message);
}

beforeAll(async () => {
  await seedReferenceData();
  const { data: members, error: memberError } = await db
    .from("members")
    .insert([0, 1, 2].map((i) => ({ name: `Repo Test ${i}`, email: `attendance-repo-${RUN}-${i}@example.com`, joined_at: "2026-01-01", status: "active" })))
    .select("id");
  if (memberError) throw new Error(memberError.message);
  memberIds = members!.map((m) => m.id) as [string, string, string];

  const { data: type } = await db.from("prickle_types").select("id").limit(1).single();
  const { data: prickles, error: prickleError } = await db
    .from("prickles")
    .insert(
      [0, 1, 2].map((i) => ({
        type_id: type!.id,
        start_time: new Date(Date.UTC(2097, 0, 1, 9 + i)).toISOString(),
        end_time: new Date(Date.UTC(2097, 0, 1, 10 + i)).toISOString(),
        source: "calendar",
      })),
    )
    .select("id");
  if (prickleError) throw new Error(prickleError.message);
  prickleIds = prickles!.map((p) => p.id) as [string, string, string];
});

afterAll(async () => {
  await clearAttendance();
  await db.from("prickles").delete().in("id", prickleIds);
  await db.from("members").delete().in("id", memberIds);
});

defineAttendanceContract("SupabaseAttendanceRepository", () => ({
  get memberIds() {
    return memberIds;
  },
  get prickleIds() {
    return prickleIds;
  },
  repo: () => new SupabaseAttendanceRepository(db),
  seed: async (records: SeedRecord[]) => {
    await clearAttendance();
    const rows = records.map((r) => ({
      member_id: memberIds[r.member],
      prickle_id: prickleIds[r.prickle],
      join_time: r.join,
      leave_time: r.leave ?? r.join,
      confidence_score: "high" as const,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from("prickle_attendance").insert(rows.slice(i, i + 500));
      if (error) throw new Error(error.message);
    }
  },
}));
