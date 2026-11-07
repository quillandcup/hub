import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/data/db";
import { createRepos } from "@/lib/data/repos";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const admin = getTestSupabaseAdminClient();
const repos = createRepos(admin as unknown as Db);
const RUN = Date.now();
const users: string[] = [];

async function makeUser(label: string) {
  const { data, error } = await admin.auth.admin.createUser({ email: `access-places-${label}-${RUN}@example.com`, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  users.push(data.user.id);
  return data.user.id;
}

describe("AccessEventRepository.placesBySession (database)", () => {
  let me: string;
  let other: string;
  const s1 = crypto.randomUUID();
  const s2 = crypto.randomUUID();
  const s3 = crypto.randomUUID();

  beforeAll(async () => {
    me = await makeUser("me");
    other = await makeUser("other");
    const base = { path: "/x", is_page: true };
    const { error } = await admin.from("access_events").insert([
      { ...base, user_id: me, session_id: s1, city: "Old City", country: "US", created_at: "2026-01-01T00:00:00Z" },
      { ...base, user_id: me, session_id: s1, city: "Heredia", country: "CR", created_at: "2026-01-02T00:00:00Z" },
      { ...base, user_id: me, session_id: s1, created_at: "2026-01-03T00:00:00Z" },
      { ...base, user_id: me, session_id: s2, created_at: "2026-01-02T00:00:00Z" },
      { ...base, user_id: other, session_id: s3, city: "Elsewhere", country: "FR", created_at: "2026-01-02T00:00:00Z" },
    ]);
    if (error) throw new Error(error.message);
  });

  afterAll(async () => {
    for (const id of users) await admin.auth.admin.deleteUser(id);
  });

  it("returns the latest located place of the user's own sessions and never someone else's", async () => {
    const places = await repos.accessEvents.placesBySession(me, [s1, s2, s3]);
    expect([...places.entries()]).toEqual([[s1, { city: "Heredia", country: "CR" }]]);
  });
});
