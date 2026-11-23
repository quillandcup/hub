import { afterAll, beforeAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseCareRepository } from "@/lib/data/care";
import { defineCareContract } from "@/tests/helpers/care-contract";
import { createRunMembers, createRunUser, deleteRunMembers, type PeopleMember } from "@/tests/helpers/people-fixtures";
import { getTestSupabaseAdminClient, getTestSupabaseClient } from "@/tests/helpers/supabase";
import { giveRoles } from "@/tests/helpers/user-roles";

const admin = getTestSupabaseAdminClient();
const db = admin as unknown as Db;
const RUN = `${Date.now()}`;
const PASSWORD = "test-password-12345!"; // createRunUser's

const ROLES = { manager: "community_manager", colleague: "community_manager", admin: "admin", assistant: "assistant", plain: "member" } as const;
type Who = keyof typeof ROLES;

let members: PeopleMember[] = [];
const users = {} as Record<Who, string>;
/** A client signed in as each user: the hand-over steps answer for the caller the session names. */
const sessions = new Map<string, Db>();

beforeAll(async () => {
  members = await createRunMembers(db, "care-repo", RUN, 3);
  for (const who of Object.keys(ROLES) as Who[]) {
    const label = `care-repo-${who}`;
    const id = await createRunUser(admin, label, RUN);
    users[who] = id;
    await giveRoles(admin, id, ROLES[who]);
    const client = getTestSupabaseClient();
    const signedIn = await client.auth.signInWithPassword({ email: `${label}-${RUN}@example.com`, password: PASSWORD });
    if (signedIn.error) throw new Error(signedIn.error.message);
    sessions.set(id, client as unknown as Db);
  }
});

afterAll(async () => {
  await deleteRunMembers(db, members); // cascades to their engagements
  for (const id of Object.values(users)) if (id) await admin.auth.admin.deleteUser(id);
});

defineCareContract("SupabaseCareRepository", () => ({
  repo: () => new SupabaseCareRepository(db),
  repoAs: (userId) => new SupabaseCareRepository(sessions.get(userId)!),
  get members() {
    return members;
  },
  get openedBy() {
    return users.manager;
  },
  get otherOwner() {
    return users.colleague;
  },
  get admin() {
    return users.admin;
  },
  get assistant() {
    return users.assistant;
  },
  get plain() {
    return users.plain;
  },
  missingId: "care_ZZZZZZZZZZZZ",
  clear: async () => {
    const { error } = await db.from("care_engagements").delete().in("member_id", members.map((m) => m.id));
    if (error) throw new Error(error.message);
  },
}));
