import { afterAll, beforeAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseAdminNoteRepository } from "@/lib/data/admin-notes";
import { defineAdminNoteContract } from "@/tests/helpers/admin-note-contract";
import { createRunUser } from "@/tests/helpers/people-fixtures";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `${Date.now()}`;
let members: [string, string];
let userId = "";

const clear = async () => {
  if (!members) return;
  const { error } = await db.from("member_admin_notes").delete().in("member_id", members);
  if (error) throw new Error(error.message);
};

beforeAll(async () => {
  userId = await createRunUser(getTestSupabaseAdminClient(), "admin-note-user", RUN);
  const made = await db
    .from("members")
    .insert([0, 1].map((i) => ({ name: `${i === 0 ? "Ada" : "Fern"} Example ${RUN}`, email: `admin-note-repo-${RUN}-${i}@example.com`, joined_at: "2026-01-01", status: "active" })))
    .select("id, email");
  if (made.error) throw new Error(made.error.message);
  members = [0, 1].map((i) => made.data!.find((m) => m.email === `admin-note-repo-${RUN}-${i}@example.com`)!.id) as [string, string];
});

afterAll(async () => {
  await clear();
  await db.from("members").delete().in("id", members ?? []);
  if (userId) await getTestSupabaseAdminClient().auth.admin.deleteUser(userId);
});

defineAdminNoteContract("SupabaseAdminNoteRepository", () => ({
  repo: () => new SupabaseAdminNoteRepository(db),
  get members() {
    return members;
  },
  get userId() {
    return userId;
  },
  missingMemberId: "mbr_ZZZZZZZZZZZ9",
  clear,
}));
