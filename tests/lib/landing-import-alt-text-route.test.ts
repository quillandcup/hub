import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";
import { exportZip } from "@/tests/helpers/kajabi-export";

const state: { auth: "ok" | "anon" | "nonadmin"; repos: Repos } = { auth: "ok", repos: undefined as never };
const recorded: { action: string; outcome: unknown }[] = [];

vi.mock("@/lib/analytics/server", () => ({
  withAction: async (action: string, run: () => Promise<Response>, classify: (r: Response) => unknown) => {
    const result = await run();
    recorded.push({ action, outcome: classify(result) });
    return result;
  },
}));
vi.mock("@/lib/admin-auth", () => ({
  requireActionPermission: async () => (state.auth === "ok" ? { ok: true, user: { id: "00000000-0000-4000-a000-0000000000a1" }, supabase: {} } : { ok: false, error: state.auth === "anon" ? "Not authenticated" : "Not authorized" }),
}));
vi.mock("@/lib/data/server", () => ({ getServiceRepos: () => state.repos }));

import { POST } from "@/app/api/admin/landing-pages/import/alt-text/route";

const request = (fields: Record<string, string | File>) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return new NextRequest("http://localhost/api/admin/landing-pages/import/alt-text", { method: "POST", body: form });
};
const zip = (bytes: Uint8Array = exportZip()) => new File([bytes as BlobPart], "export.zip", { type: "application/zip" });

beforeEach(() => {
  state.auth = "ok";
  state.repos = createInMemoryRepos(new InMemoryDataset());
  recorded.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/admin/landing-pages/import/alt-text", () => {
  it("refuses anyone who can't edit pages", async () => {
    state.auth = "anon";
    expect((await POST(request({ file: zip() }))).status).toBe(401);
    state.auth = "nonadmin";
    expect((await POST(request({ file: zip() }))).status).toBe(403);
  });

  it("suggests from the headings by rules when the model is not set up, and says so", async () => {
    const response = await POST(request({ file: zip() }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "suggested", ai: "not_set_up", suggestions: [{ alt: "Example Press LLC logo", by: "fallback" }, { alt: 'Picture for "Join the list"', by: "fallback" }] });
    expect(recorded).toEqual([{ action: "landing_page_imported", outcome: { ok: true, detail: "alt_text" } }]);
  });

  it("answers 400 for no file or a file that is not an export, and 413 for one over the cap", async () => {
    expect((await POST(request({}))).status).toBe(400);
    const bad = await POST(request({ file: new File(["hello"], "x.zip") }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ status: "error" });
    expect((await POST(request({ file: new File([new Uint8Array(5 * 1024 * 1024)], "big.zip") }))).status).toBe(413);
    expect(recorded.every((r) => (r.outcome as { ok: boolean }).ok === false)).toBe(true);
  });

  it("limits how many times one person can ask", async () => {
    let last = 200;
    for (let i = 0; i < 41; i++) last = (await POST(request({ file: zip() }))).status;
    expect(last).toBe(429);
  });
});
