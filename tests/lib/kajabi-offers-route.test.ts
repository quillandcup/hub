import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeTables } from "@/tests/helpers/server-page";

let tables: FakeTables = {};
let signedIn = true;
vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: async () => (signedIn ? { user: { id: "admin" }, forbidden: false, supabase: createFakeSupabase(tables) } : { user: null }),
}));

import { GET } from "@/app/api/admin/kajabi-offers/route";

const call = () => GET(new NextRequest("http://localhost/api/admin/kajabi-offers"));

beforeEach(() => {
  signedIn = true;
  tables = {};
});

describe("GET /api/admin/kajabi-offers", () => {
  it("is for signed-in admins", async () => {
    signedIn = false;
    expect((await call()).status).toBe(401);
  });

  it("lists each offer name once, sorted, leaving out offers without a name", async () => {
    tables = { "bronze.kajabi_offers": { data: [{ name: "Zine Club" }, { name: "Academy" }, { name: null }, { name: "Academy" }, { name: "" }] } };

    expect(await (await call()).json()).toEqual({ names: ["Academy", "Zine Club"] });
  });
});
