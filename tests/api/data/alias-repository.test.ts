import { afterAll, beforeAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseAliasRepository } from "@/lib/data/aliases";
import { defineAliasContract } from "@/tests/helpers/alias-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `${Date.now()}`;
let memberIds: [string, string];
const memberEmails: [string, string] = [`alias-repo-${RUN}-0@example.com`, `alias-repo-${RUN}-1@example.com`];
let counter = 0;

const clear = async () => {
  for (const table of ["member_name_aliases", "member_email_aliases"] as const) {
    const { error } = await db.from(table).delete().in("member_id", memberIds);
    if (error) throw new Error(error.message);
  }
};

beforeAll(async () => {
  const { data, error } = await db
    .from("members")
    .insert([0, 1].map((i) => ({ name: `Alias Member ${i} ${RUN}`, email: memberEmails[i as 0 | 1], joined_at: "2026-01-01", status: "active" })))
    .select("id");
  if (error) throw new Error(error.message);
  memberIds = [data![0].id, data![1].id];
});

afterAll(async () => {
  await clear();
  await db.from("members").delete().in("id", memberIds);
});

defineAliasContract("SupabaseAliasRepository", () => ({
  get memberIds() {
    return memberIds;
  },
  memberEmails,
  repo: () => new SupabaseAliasRepository(db),
  unique: (label) => `${label} ${RUN} ${++counter}`,
  seed: async ({ names = [], emails = [] }) => {
    await clear();
    for (let i = 0; i < names.length; i += 500) {
      const { error } = await db
        .from("member_name_aliases")
        .insert(names.slice(i, i + 500).map((a) => ({ member_id: memberIds[a.member], alias: a.alias, source: a.source, active: a.active ?? true })));
      if (error) throw new Error(error.message);
    }
    if (emails.length > 0) {
      // canonical_email is filled in by a trigger
      const { error } = await db
        .from("member_email_aliases")
        .insert(emails.map((e) => ({ member_id: memberIds[e.member], alias_email: e.email, source: "manual", active: e.active ?? true })) as never);
      if (error) throw new Error(error.message);
    }
  },
}));
