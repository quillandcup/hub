import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

const auth = vi.hoisted(() => ({ admin: true }));
vi.mock("@/lib/admin-auth", () => ({
  requireAdminAction: async () => (auth.admin ? { ok: true, user: { id: "user-admin", email: "admin@example.test" }, supabase: {} } : { ok: false, error: "Not authorized" }),
}));
const data = vi.hoisted(() => ({ current: null as null | unknown }));
vi.mock("@/lib/data/repos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data/repos")>()),
  createRepos: () => data.current,
}));
vi.mock("@/lib/analytics/server", () => ({ withAction: async (_name: string, run: () => Promise<unknown>) => run() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { importProspects, reviewProspect } from "@/app/(admin)/admin/outreach/prospects/actions";

let repos: ReturnType<typeof createInMemoryRepos>;
beforeEach(() => {
  auth.admin = true;
  repos = createInMemoryRepos(new InMemoryDataset());
  data.current = repos;
});

describe("importProspects", () => {
  it("adds prospects and reports a summary", async () => {
    const result = await importProspects("@ada.example writing my first novel");
    expect(result).toEqual({ summary: { added: 1, alreadyProspects: 0, alreadyMembers: 0, unreadable: [] } });
    expect(await repos.prospects.list()).toHaveLength(1);
  });

  it("refuses non-admins, empty text and huge pastes", async () => {
    expect(await importProspects("   ")).toEqual({ error: "Paste at least one handle or profile link." });
    expect(await importProspects("a".repeat(200_001))).toMatchObject({ error: expect.stringContaining("too much") });
    auth.admin = false;
    expect(await importProspects("@ada.example")).toEqual({ error: "Not authorized" });
    expect(await repos.prospects.list()).toHaveLength(0);
  });
});

describe("reviewProspect", () => {
  it("records a decision, trimming the reason", async () => {
    await importProspects("@ada.example");
    const [p] = await repos.prospects.list();

    expect(await reviewProspect(p.id, "rejected", "  sells editing  ")).toEqual({ ok: true });

    expect((await repos.prospects.list())[0]).toMatchObject({ status: "rejected", rejectReason: "sells editing" });
  });

  it("refuses non-admins, odd ids and unknown statuses", async () => {
    await importProspects("@ada.example");
    const [p] = await repos.prospects.list();
    expect(await reviewProspect("not-an-id", "rejected")).toEqual({ error: "Unknown prospect." });
    expect(await reviewProspect(p.id, "banished")).toEqual({ error: "Unknown status." });
    auth.admin = false;
    expect(await reviewProspect(p.id, "rejected")).toEqual({ error: "Not authorized" });
    expect((await repos.prospects.list())[0].status).toBe("new");
  });
});
