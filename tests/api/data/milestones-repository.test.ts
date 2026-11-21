import { afterAll, beforeAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseMilestoneRepository } from "@/lib/data/milestones";
import { SupabaseWritingRepository } from "@/lib/data/writing";
import { defineMilestonesContract } from "@/tests/helpers/milestones-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `mlst${Date.now()}`;
let memberIds: [string, string];
let staffUserId = "";

const must = <T>(result: { data: T; error: { message: string } | null }) => {
  if (result.error) throw new Error(result.error.message);
  return result.data;
};

const clear = async () => {
  for (const table of ["member_milestones", "member_books", "writing_projects"] as const) {
    const { error } = await db.from(table).delete().in("member_id", memberIds);
    if (error) throw new Error(error.message);
  }
};

beforeAll(async () => {
  const rows = must(
    await db
      .from("members")
      .insert([
        { name: "Ada Example", email: `${RUN}-ada@example.com`, joined_at: "2026-01-01", status: "active" },
        { name: "Bo Example", email: `${RUN}-bo@example.com`, joined_at: "2026-01-01", status: "active" },
      ])
      .select("id, email")
      .order("email"),
  );
  memberIds = [rows![0].id, rows![1].id];
  const user = await db.auth.admin.createUser({ email: `${RUN}-staff@example.com`, email_confirm: true });
  if (user.error) throw new Error(user.error.message);
  staffUserId = user.data.user.id;
}, 60_000);

afterAll(async () => {
  await clear();
  await db.from("members").delete().in("id", memberIds);
  await db.auth.admin.deleteUser(staffUserId);
}, 60_000);

defineMilestonesContract("SupabaseMilestoneRepository", () => ({
  repo: () => new SupabaseMilestoneRepository(db),
  get members() {
    return memberIds;
  },
  missingMemberId: "mbr_ZZZZZZZZZZZZ",
  get staffUserId() {
    return staffUserId;
  },
  addBook: async (memberId) => {
    must(await db.from("member_books").insert({ member_id: memberId, title: "A Book", published_date: "2026-01-01", cover_url: "" }));
  },
  deleteBooks: async (memberId) => {
    must(await db.from("member_books").update({ deleted_at: new Date().toISOString() }).eq("member_id", memberId));
  },
  addProject: (memberId) => new SupabaseWritingRepository(db).createProject(memberId, "A Fake Novel", "drafting"),
  clear,
}));
