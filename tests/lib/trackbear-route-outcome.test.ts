import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/** The TrackBear import records whether it worked and what came over (counts only) as the outcome's detail. */
const outcomes: [string, unknown][] = [];
vi.mock("@/lib/analytics/server", () => ({
  withAction: async (name: string, run: () => Promise<unknown>, classify: (r: unknown) => unknown) => {
    const result = await run();
    outcomes.push([name, classify(result)]);
    return result;
  },
}));
const getCurrentUser = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: async () => ({ memberId: "mbr_AAAAAAAAAAA1", isSudo: false }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({ storage: {} }) }));
vi.mock("@/lib/data/repos", () => ({ createRepos: () => ({ writing: {}, media: {} }) }));
vi.mock("@/lib/trackbear-cover", () => ({ makeTrackbearCoverCopier: () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const extractTrackbearExport = vi.hoisted(() => vi.fn());
vi.mock("@/lib/trackbear-import", () => ({
  extractTrackbearExport,
  TrackbearImportError: class TrackbearImportError extends Error {},
}));
const runTrackbearImport = vi.hoisted(() => vi.fn());
vi.mock("@/lib/trackbear-import-runner", () => ({ runTrackbearImport }));

import { POST } from "@/app/api/projects/import/trackbear/route";

const upload = () => {
  const form = new FormData();
  form.set("file", new File(["zip"], "export.zip"));
  return new NextRequest("http://localhost/api/projects/import/trackbear", { method: "POST", body: form });
};

beforeEach(() => {
  outcomes.length = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  getCurrentUser.mockResolvedValue({ id: "u1", email: "ada@example.test" });
  extractTrackbearExport.mockReturnValue({});
  runTrackbearImport.mockResolvedValue({ created: { projects: 2, entries: 95, goals: 3, startingBalances: 1, covers: 0 } });
});

describe("POST /api/projects/import/trackbear outcome", () => {
  it("records what came over, as counts", async () => {
    expect((await POST(upload())).status).toBe(200);
    expect(outcomes).toEqual([["trackbear_imported", { ok: true, detail: "p2 e95 g3" }]]);
  });

  it("records an import that stopped partway as a failure with its status", async () => {
    runTrackbearImport.mockRejectedValue(new Error("database down"));
    expect((await POST(upload())).status).toBe(500);
    expect(outcomes).toEqual([["trackbear_imported", { ok: false, detail: "500" }]]);
  });

  it("records a refused upload (not signed in) as a failure too", async () => {
    getCurrentUser.mockResolvedValue(null);
    expect((await POST(upload())).status).toBe(401);
    expect(outcomes).toEqual([["trackbear_imported", { ok: false, detail: "401" }]]);
  });
});
