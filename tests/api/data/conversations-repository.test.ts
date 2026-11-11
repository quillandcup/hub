import { afterAll, beforeAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseConversationRepository } from "@/lib/data/conversations";
import { defineConversationContract } from "@/tests/helpers/conversations-contract";
import { createRunMembers, createRunUser, deleteRunMembers, type PeopleMember } from "@/tests/helpers/people-fixtures";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const admin = getTestSupabaseAdminClient();
const db = admin as unknown as Db;
const RUN = `${Date.now()}`;

let members: PeopleMember[] = [];
let userId = "";

beforeAll(async () => {
  members = await createRunMembers(db, "conversations-repo", RUN, 3);
  userId = await createRunUser(admin, "conversations-repo-user", RUN);
});

afterAll(async () => {
  await deleteRunMembers(db, members); // cascades to their conversations
  if (userId) await admin.auth.admin.deleteUser(userId);
});

defineConversationContract("SupabaseConversationRepository", () => ({
  repo: () => new SupabaseConversationRepository(db),
  get members() {
    return members;
  },
  get openedBy() {
    return userId;
  },
  missingId: "conv_ZZZZZZZZZZZZ",
  clear: async () => {
    const { error } = await db.from("conversations").delete().in("member_id", members.map((m) => m.id));
    if (error) throw new Error(error.message);
  },
}));
