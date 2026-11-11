import { afterAll, beforeAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseCareRepository } from "@/lib/data/care";
import { defineCareContract } from "@/tests/helpers/care-contract";
import { createRunMembers, createRunUser, deleteRunMembers, type PeopleMember } from "@/tests/helpers/people-fixtures";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const admin = getTestSupabaseAdminClient();
const db = admin as unknown as Db;
const RUN = `${Date.now()}`;

let members: PeopleMember[] = [];
let userId = "";

beforeAll(async () => {
  members = await createRunMembers(db, "care-repo", RUN, 3);
  userId = await createRunUser(admin, "care-repo-user", RUN);
});

afterAll(async () => {
  await deleteRunMembers(db, members); // cascades to their engagements
  if (userId) await admin.auth.admin.deleteUser(userId);
});

defineCareContract("SupabaseCareRepository", () => ({
  repo: () => new SupabaseCareRepository(db),
  get members() {
    return members;
  },
  get openedBy() {
    return userId;
  },
  missingId: "care_ZZZZZZZZZZZZ",
  clear: async () => {
    const { error } = await db.from("care_engagements").delete().in("member_id", members.map((m) => m.id));
    if (error) throw new Error(error.message);
  },
}));
