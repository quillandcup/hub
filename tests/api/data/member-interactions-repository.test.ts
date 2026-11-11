import { afterAll, beforeAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseMemberInteractionRepository } from "@/lib/data/member-interactions";
import { defineMemberInteractionContract } from "@/tests/helpers/member-interactions-contract";
import { createRunMembers, deleteRunMembers, type PeopleMember } from "@/tests/helpers/people-fixtures";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `${Date.now()}`;
let members: PeopleMember[] = [];
const ids = () => members.map((m) => m.id);

beforeAll(async () => {
  members = await createRunMembers(db, "interactions-repo", RUN, 4);
});

afterAll(async () => {
  await deleteRunMembers(db, members); // cascades to their interactions
});

defineMemberInteractionContract("SupabaseMemberInteractionRepository", () => ({
  get memberIds() {
    return ids() as unknown as readonly [string, string, string, string];
  },
  repo: () => new SupabaseMemberInteractionRepository(db),
  add: async (rows) => {
    const inserts = rows.map((r) => ({ member_a: ids()[r.a], member_b: ids()[r.b], kind: r.kind ?? "dm", occurred_at: r.at, visibility: "private" }));
    for (let i = 0; i < inserts.length; i += 500) {
      const { error } = await db.from("member_interactions").insert(inserts.slice(i, i + 500));
      if (error) throw new Error(error.message);
    }
  },
  clear: async () => {
    const { error } = await db.from("member_interactions").delete().in("member_a", ids());
    if (error) throw new Error(error.message);
  },
}));
