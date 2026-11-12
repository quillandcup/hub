import { afterAll, beforeAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseCareTrackedDmRepository } from "@/lib/data/care-dms";
import { defineCareDmsContract } from "@/tests/helpers/care-dms-contract";
import { createRunMembers, createRunUser, deleteRunMembers, type PeopleMember } from "@/tests/helpers/people-fixtures";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const admin = getTestSupabaseAdminClient();
const db = admin as unknown as Db;
const RUN = `${Date.now()}`;

let members: PeopleMember[] = [];
let users: string[] = [];
let counter = 0;

beforeAll(async () => {
  members = await createRunMembers(db, "care-dms", RUN, 2);
  users = [await createRunUser(admin, "care-dms-a", RUN), await createRunUser(admin, "care-dms-b", RUN)];
});

afterAll(async () => {
  await deleteRunMembers(db, members); // cascades to their tracked DMs
  for (const id of users) await admin.auth.admin.deleteUser(id); // and so do these
});

defineCareDmsContract("SupabaseCareTrackedDmRepository", () => ({
  repo: () => new SupabaseCareTrackedDmRepository(db),
  get members() {
    return members;
  },
  get users() {
    return [users[0], users[1]] as [string, string];
  },
  channel: (label) => `DT${RUN}${label.toUpperCase()}${++counter}`,
  clear: async () => {
    if (users.length === 0) return;
    const { error } = await db.from("care_tracked_dms").delete().in("tracked_by", users);
    if (error) throw new Error(error.message);
  },
}));
