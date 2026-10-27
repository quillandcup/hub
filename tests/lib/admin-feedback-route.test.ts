import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeTables } from "@/tests/helpers/server-page";

let tables: FakeTables = {};
let fake = createFakeSupabase();
let signedIn = true;
vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: async () => (signedIn ? { user: { id: "admin" }, forbidden: false, supabase: fake } : { user: null }),
}));

import { GET } from "@/app/api/admin/feedback/route";

beforeEach(() => {
  signedIn = true;
  tables = {
    feedback: {
      data: [
        { id: "f1", user_id: "u1", screenshot_path: null, member: { name: "Zed Legal", display_name: "Ada E", email: "ada@example.test" } },
        { id: "f2", user_id: "u2", screenshot_path: null, member: { name: "Bea Plain", display_name: null, email: "bea@example.test" } },
      ],
    },
    user_profiles: { data: [{ id: "u1", email: "ada@example.test" }] },
  };
  fake = createFakeSupabase(tables);
});

describe("GET /api/admin/feedback", () => {
  it("is for signed-in admins", async () => {
    signedIn = false;
    expect((await GET(new NextRequest("http://localhost/api/admin/feedback"))).status).toBe(401);
  });

  it("asks for the submitter's display name beside the legal name and passes both through", async () => {
    const res = await GET(new NextRequest("http://localhost/api/admin/feedback"));
    const { items } = await res.json();

    const select = fake.queries.find((q) => q.table === "feedback")!.calls.find((c) => c.method === "select")!;
    expect(String(select.args[0])).toContain("member:members(name, display_name, email)");
    expect(items[0].member).toMatchObject({ name: "Zed Legal", display_name: "Ada E" });
    expect(items[1].member).toMatchObject({ name: "Bea Plain", display_name: null });
    expect(items[0].submitter_email).toBe("ada@example.test");
  });
});
