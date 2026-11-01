import { afterAll, beforeAll } from "vitest";
import { SupabaseAttendanceRepository } from "@/lib/data/attendance";
import type { Db } from "@/lib/data/db";
import { SupabasePrickleRepository, type PrickleDetail } from "@/lib/data/prickles";
import { defineAttendanceContract, type ContractMember, type SeedRecord } from "@/tests/helpers/attendance-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `${Date.now()}`;
let memberIds: [string, string, string];
let members: [ContractMember, ContractMember, ContractMember];
let prickleIds: [string, string, string];
let prickles: [PrickleDetail, PrickleDetail, PrickleDetail];
let typeIds: string[];

async function clearAttendance() {
  const { error } = await db.from("prickle_attendance").delete().in("member_id", memberIds);
  if (error) throw new Error(error.message);
}

beforeAll(async () => {
  const { data: memberRows, error: memberError } = await db
    .from("members")
    .insert(
      [0, 1, 2].map((i) => ({
        name: `Repo Test ${i} ${RUN}`,
        display_name: i === 0 ? `Pen Zero ${RUN}` : null,
        email: `attendance-repo-${RUN}-${i}@example.com`,
        joined_at: "2026-01-01",
        status: "active",
      })),
    )
    .select("id, name, display_name, email");
  if (memberError) throw new Error(memberError.message);
  members = [0, 1, 2].map((i) => {
    const row = memberRows!.find((m) => m.email === `attendance-repo-${RUN}-${i}@example.com`)!;
    return { id: row.id, name: row.name, displayName: row.display_name, email: row.email };
  }) as [ContractMember, ContractMember, ContractMember];
  memberIds = members.map((m) => m.id) as [string, string, string];

  const { data: typeRows, error: typeError } = await db
    .from("prickle_types")
    .insert([
      { name: `Attendance Contract Writing ${RUN}`, normalized_name: `attendance-contract-writing-${RUN}`, purpose: "writing" },
      { name: `Attendance Contract Social ${RUN}`, normalized_name: `attendance-contract-social-${RUN}`, purpose: "social" },
    ])
    .select("id, purpose");
  if (typeError) throw new Error(typeError.message);
  typeIds = typeRows!.map((t) => t.id);
  const typeFor = (purpose: string) => typeRows!.find((t) => t.purpose === purpose)!.id;

  const startOf = (i: number) => new Date(Date.UTC(2097, 0, 1, 9 + i)).toISOString();
  const { data: prickleRows, error: prickleError } = await db
    .from("prickles")
    .insert(
      [
        { type_id: typeFor("writing"), host: memberIds[2] },
        { type_id: typeFor("social"), host: null },
        { type_id: typeFor("writing"), host: null },
      ].map((p, i) => ({ ...p, start_time: startOf(i), end_time: new Date(Date.parse(startOf(i)) + 3_600_000).toISOString(), source: "calendar" })),
    )
    .select("id, start_time");
  if (prickleError) throw new Error(prickleError.message);
  prickleIds = [...prickleRows!].sort((a, b) => a.start_time.localeCompare(b.start_time)).map((p) => p.id) as [string, string, string];

  // What the joins should report for each prickle, as the prickle repository (verified by its own contract) reads it.
  const detailed = await new SupabasePrickleRepository(db).byIds(prickleIds);
  prickles = prickleIds.map((id) => detailed.find((p) => p.id === id)!) as [PrickleDetail, PrickleDetail, PrickleDetail];
});

afterAll(async () => {
  await clearAttendance();
  await db.from("prickles").delete().in("id", prickleIds);
  await db.from("prickle_types").delete().in("id", typeIds);
  await db.from("members").delete().in("id", memberIds);
});

defineAttendanceContract("SupabaseAttendanceRepository", () => ({
  get memberIds() {
    return memberIds;
  },
  get prickleIds() {
    return prickleIds;
  },
  get members() {
    return members;
  },
  get prickles() {
    return prickles;
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
