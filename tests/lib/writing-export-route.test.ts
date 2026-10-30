import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

// GET /api/projects/export: the signed-in member's progress entries as CSV (their own, optionally one project).

let dataset = new InMemoryDataset();
let repos = createInMemoryRepos(dataset);
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
const getCurrentUser = vi.fn();
vi.mock("@/lib/auth", () => ({ getCurrentUser: () => getCurrentUser() }));
const getEffectiveIdentity = vi.fn();
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: (...args: unknown[]) => getEffectiveIdentity(...args) }));

import { GET } from "@/app/api/projects/export/route";

const ADA = "mbr_AAAAAAAAAAA1";
const project = (id: string, member: string, title: string) => ({
  id, member_id: member, title, description: null, cover_asset_id: null, cover_url: null, external_id: null, phase: "drafting", show_on_profile: false, archived_at: null, created_at: "2026-01-01T00:00:00Z",
});
const entry = (id: string, member: string, projectId: string, extra: object) => ({
  id, member_id: member, project_id: projectId, prickle_id: null, entry_date: "2026-02-01", measure: "words", mode: "delta", amount: 100, note: null, tags: [], external_id: null, created_at: "2026-02-01T00:00:00Z", ...extra,
});

const call = (query = "") => GET(new NextRequest(`http://localhost/api/projects/export${query}`));

beforeEach(() => {
  vi.clearAllMocks();
  dataset = new InMemoryDataset({
    writingProjects: [project("wprj_1", ADA, "Novel, Draft 2"), project("wprj_2", ADA, "Essays"), project("wprj_3", "mbr_AAAAAAAAAAA2", "Not Mine")],
    writingEntries: [
      entry("wpe_1", ADA, "wprj_1", { entry_date: "2026-02-03", note: 'said "hi"', tags: ["a", "b"], amount: 250 }),
      entry("wpe_2", ADA, "wprj_2", { entry_date: "2026-02-01", measure: "pages", amount: 3 }),
      entry("wpe_3", "mbr_AAAAAAAAAAA2", "wprj_3", {}),
    ],
  });
  repos = createInMemoryRepos(dataset);
  getCurrentUser.mockResolvedValue({ id: "user-1", email: "ada@example.test" });
  getEffectiveIdentity.mockResolvedValue({ memberId: ADA, memberName: "Ada Example", memberEmail: "ada@example.test", isSudo: false });
});

describe("GET /api/projects/export", () => {
  it("needs a signed-in member with a member record", async () => {
    getCurrentUser.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    getCurrentUser.mockResolvedValue({ id: "user-1", email: "x@example.test" });
    getEffectiveIdentity.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
  });

  it("exports the member's entries by date, escaped, with the project's title", async () => {
    const res = await call();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("writing-progress-all-projects.csv");
    expect((await res.text()).split("\n")).toEqual([
      "date,project,measure,mode,amount,note,tags",
      "2026-02-01,Essays,pages,delta,3,,",
      '2026-02-03,"Novel, Draft 2",words,delta,250,"said ""hi""",a;b',
    ]);
  });

  it("exports one project when asked", async () => {
    const res = await call("?projectId=wprj_1");

    expect(res.headers.get("Content-Disposition")).toContain('filename="writing-progress.csv"');
    expect((await res.text()).split("\n")).toHaveLength(2);
  });

  it("reports a database failure", async () => {
    vi.spyOn(repos.writing, "exportEntries").mockRejectedValue(new Error("db down"));

    const res = await call();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "db down" });
  });
});
