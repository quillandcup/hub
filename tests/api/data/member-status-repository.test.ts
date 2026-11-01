import { afterAll, beforeAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseMemberStatusRepository } from "@/lib/data/member-status-overrides";
import { defineMemberStatusContract } from "@/tests/helpers/member-status-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `${Date.now()}`;
let members: { id: string; name: string; email: string }[] = [];
let userId = "";

// Everything the contract stores hangs off the run's three members, so clearing is by member.
const clear = async () => {
  const ids = members.map((m) => m.id);
  for (const table of ["member_hiatus_history", "member_status_overrides", "member_join_date_overrides", "member_profile_overrides"] as const) {
    const { error } = await db.from(table).delete().in("member_id", ids);
    if (error) throw new Error(error.message);
  }
};

beforeAll(async () => {
  const rows = [
    { name: `Ada Example ${RUN}`, display_name: "Ada E." },
    { name: `Bo Example ${RUN}`, display_name: null },
    { name: `Cy Example ${RUN}`, display_name: null },
  ].map((r, i) => ({ ...r, email: `member-status-repo-${RUN}-${i}@example.com`, joined_at: "2026-01-01", status: "active" }));
  const { data, error } = await db.from("members").insert(rows).select("id, name, email");
  if (error) throw new Error(error.message);
  members = rows.map((r) => data!.find((m) => m.email === r.email)!);

  const created = await db.auth.admin.createUser({ email: `member-status-repo-user-${RUN}@example.com`, password: "test-password-12345!", email_confirm: true });
  if (created.error || !created.data.user) throw new Error(created.error?.message ?? "no user");
  userId = created.data.user.id;
});

afterAll(async () => {
  await clear();
  await db.from("members").delete().in("id", members.map((m) => m.id));
  if (userId) await db.auth.admin.deleteUser(userId);
});

defineMemberStatusContract("SupabaseMemberStatusRepository", () => ({
  repo: () => new SupabaseMemberStatusRepository(db),
  get members() {
    return members;
  },
  get userId() {
    return userId;
  },
  missingId: "00000000-0000-4000-8000-000000000000",
  missingMemberId: "mbr_ZZZZZZZZZZZZ",
  seedJoinDate: async (memberId, firstJoinedAt) => {
    const { error } = await db.from("member_join_date_overrides").insert({ member_id: memberId, first_joined_at: firstJoinedAt });
    if (error) throw new Error(error.message);
  },
  clear,
}));
