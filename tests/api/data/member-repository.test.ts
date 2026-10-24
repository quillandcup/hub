import { afterAll, beforeAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseMemberRepository } from "@/lib/data/members";
import { defineMemberContract, type MemberSeedRecord } from "@/tests/helpers/member-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const admin = getTestSupabaseAdminClient();
const db = admin as unknown as Db;
const RUN = `${Date.now()}`;
const created: string[] = [];
const emails = new Map<string, string>();
let authUserIds: [string, string];
const unusedUserId = "33333333-3333-4333-8333-333333333333";

async function deleteMembers() {
  const ids = created.splice(0);
  for (let i = 0; i < ids.length; i += 100) {
    const { error } = await db.from("members").delete().in("id", ids.slice(i, i + 100));
    if (error) throw new Error(error.message);
  }
}

beforeAll(async () => {
  const users = await Promise.all(
    [0, 1].map(async (i) => {
      const { data, error } = await admin.auth.admin.createUser({ email: `member-repo-${RUN}-${i}@example.com`, email_confirm: true });
      if (error) throw new Error(error.message);
      return data.user.id;
    }),
  );
  authUserIds = [users[0], users[1]];
});

afterAll(async () => {
  await deleteMembers();
  await Promise.all(authUserIds.map((id) => admin.auth.admin.deleteUser(id)));
});

defineMemberContract("SupabaseMemberRepository", () => ({
  get authUserIds() {
    return authUserIds;
  },
  unusedUserId,
  repo: () => new SupabaseMemberRepository(db),
  emailOf: (id) => emails.get(id)!,
  seed: async (members: MemberSeedRecord[]) => {
    await deleteMembers();
    const rows = members.map((m, i) => ({
      name: m.name,
      display_name: m.displayName ?? null,
      email: `member-repo-${RUN}-${i}-${Math.random().toString(36).slice(2, 8)}@example.com`,
      joined_at: "2026-01-01",
      status: m.status ?? "active",
      user_id: m.user === undefined ? null : authUserIds[m.user],
      staff_role: m.staffRole ?? null,
      kajabi_id: m.kajabiId ? `${m.kajabiId}-${RUN}-${i}` : null,
      stripe_customer_id: m.stripeCustomerId ? `${m.stripeCustomerId}-${RUN}-${i}` : null,
      bio: m.bio ?? null,
      instagram_url: m.instagramUrl ?? null,
      birthday_month: m.birthday?.[0] ?? null,
      birthday_day: m.birthday?.[1] ?? null,
      first_joined_at: m.firstJoinedAt ?? null,
    }));
    const ids: string[] = [];
    for (let i = 0; i < rows.length; i += 500) {
      const { data, error } = await db.from("members").insert(rows.slice(i, i + 500)).select("id, email");
      if (error) throw new Error(error.message);
      // PostgREST returns inserted rows in insertion order.
      for (const row of data!) {
        ids.push(row.id);
        emails.set(row.id, row.email);
      }
    }
    created.push(...ids);
    return ids;
  },
}));
