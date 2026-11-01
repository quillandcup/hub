import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";

// The offer names come from the billing repository, in memory here.
let repos: Repos;
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

let signedIn = true;
vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: async () => (signedIn ? { user: { id: "admin" }, forbidden: false, supabase: {} } : { user: null }),
}));

import { GET } from "@/app/api/admin/kajabi-offers/route";

const call = () => GET(new NextRequest("http://localhost/api/admin/kajabi-offers"));
const offer = (id: string, name: string | null) => ({ kajabi_offer_id: id, name });

beforeEach(() => {
  signedIn = true;
  repos = createInMemoryRepos();
});

describe("GET /api/admin/kajabi-offers", () => {
  it("is for signed-in admins", async () => {
    signedIn = false;
    expect((await call()).status).toBe(401);
  });

  it("lists each offer name once, sorted, leaving out offers without a name", async () => {
    repos = createInMemoryRepos(
      new InMemoryDataset({
        kajabiOffers: [offer("o1", "Zine Club"), offer("o2", "Academy"), offer("o3", null), offer("o4", "Academy"), offer("o5", "")],
      })
    );

    expect(await (await call()).json()).toEqual({ names: ["Academy", "Zine Club"] });
  });

  it("answers 500 with the reason when the offers can't be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    repos.billing.kajabiOfferNames = async () => {
      throw new Error("billing is down");
    };

    const res = await call();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "billing is down" });
  });
});
