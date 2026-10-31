import type { SupabaseClient } from "@supabase/supabase-js";
import type { Db } from "@/lib/data/db";

/** Three fake members for a db contract run; emails are unique per run. */
export type PeopleMember = { id: string; name: string; email: string };

/** Creates `count` members named "<Name> Example <run>" (the first has the display name "Ada E.") and returns them in order. */
export async function createRunMembers(db: Db, label: string, run: string, count = 4): Promise<PeopleMember[]> {
  const names = ["Ada", "Bo", "Cy", "Dee", "Eli"];
  const rows = names.slice(0, count).map((n, i) => ({
    name: `${n} Example ${run}`,
    display_name: i === 0 ? "Ada E." : null,
    email: `${label}-${run}-${i}@example.com`,
    joined_at: "2026-01-01",
    status: "active",
  }));
  const { data, error } = await db.from("members").insert(rows).select("id, name, email");
  if (error) throw new Error(error.message);
  return rows.map((r) => data!.find((m) => m.email === r.email)!);
}

export async function deleteRunMembers(db: Db, members: PeopleMember[]) {
  if (members.length === 0) return;
  await db.from("members").delete().in("id", members.map((m) => m.id));
}

/** Creates a Supabase Auth user (what `updated_by`, `user_id` and `completed_by` point at) and returns its id. */
export async function createRunUser(admin: SupabaseClient, label: string, run: string): Promise<string> {
  const created = await admin.auth.admin.createUser({ email: `${label}-${run}@example.com`, password: "test-password-12345!", email_confirm: true });
  if (created.error || !created.data.user) throw new Error(created.error?.message ?? "no user");
  return created.data.user.id;
}

/** A client whose every query answers with a database error: a repository must throw it, not return an empty result. */
export function failingDb(): Db {
  const answer = { data: null, error: { message: "database is down" }, count: null };
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "insert", "update", "delete", "upsert", "eq", "neq", "in", "is", "gte", "lte", "lt", "like", "or", "order", "range", "limit", "contains"]) chain[m] = () => chain;
  chain.single = async () => answer;
  chain.maybeSingle = async () => answer;
  chain.then = (resolve: (v: unknown) => unknown) => resolve(answer);
  return { from: () => chain, rpc: async () => answer } as unknown as Db;
}
