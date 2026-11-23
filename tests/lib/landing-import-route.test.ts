import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";
import { exportZip } from "@/tests/helpers/kajabi-export";

const state: { auth: "ok" | "anon" | "nonadmin"; repos: Repos; dataset: InMemoryDataset } = { auth: "ok", repos: undefined as never, dataset: undefined as never };
const revalidated: string[] = [];
const recorded: { action: string; outcome: unknown }[] = [];

vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidated.push(path) }));
vi.mock("@/lib/analytics/server", () => ({
  withAction: async (action: string, run: () => Promise<Response>, classify: (r: Response) => unknown) => {
    const result = await run();
    recorded.push({ action, outcome: classify(result) });
    return result;
  },
}));
vi.mock("@/lib/admin-auth", () => ({
  requireActionPermission: async () =>
    state.auth === "ok" ? { ok: true, user: { id: "00000000-0000-4000-a000-0000000000a1", email: "admin@example.test" }, supabase: {} } : { ok: false, error: state.auth === "anon" ? "Not authenticated" : "Not authorized" },
}));
vi.mock("@/lib/data/repos", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/data/repos")>()), createRepos: () => state.repos }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({ storage: { from: () => ({ upload: async () => ({ error: null }) }) } }) }));
vi.mock("@/lib/landing/kajabi-import-service", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/landing/kajabi-import-service")>();
  // The Kajabi CDN is not reachable from a test: pictures there come back as one the export itself has.
  return { ...real, importKajabiExport: (deps: Parameters<typeof real.importKajabiExport>[0], input: Parameters<typeof real.importKajabiExport>[1]) => real.importKajabiExport({ ...deps, fetchPicture: async () => ({ error: "offline" }) }, input) };
});

import { POST } from "@/app/api/admin/landing-pages/import/route";

function request(fields: Record<string, string | File>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return new NextRequest("http://localhost/api/admin/landing-pages/import", { method: "POST", body: form });
}
const zipFile = (bytes: Uint8Array = exportZip()) => new File([bytes as BlobPart], "export.zip", { type: "application/zip" });

beforeEach(() => {
  state.auth = "ok";
  state.dataset = new InMemoryDataset();
  state.repos = createInMemoryRepos(state.dataset);
  revalidated.length = 0;
  recorded.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/admin/landing-pages/import", () => {
  it("refuses anyone who is not signed in as an admin, and writes nothing", async () => {
    state.auth = "anon";
    expect((await POST(request({ file: zipFile(), title: "A" }))).status).toBe(401);
    state.auth = "nonadmin";
    expect((await POST(request({ file: zipFile(), title: "A" }))).status).toBe(403);
    expect(state.dataset.landingPages).toEqual([]);
  });

  it("imports an export as a draft; the same layout again is not imported until the admin chooses", async () => {
    const created = await POST(request({ file: zipFile(), title: "Example Sprint" }));
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({ status: "imported", action: "created", slug: "example-sprint" });
    expect(state.dataset.landingPages).toHaveLength(1);
    expect(revalidated).toContain("/admin/pages");

    const asked = await POST(request({ file: zipFile(), title: "Example Sprint" }));
    expect(await asked.json()).toMatchObject({ status: "choose", matches: [{ slug: "example-sprint", title: "Example Sprint" }], pages: [{ slug: "example-sprint" }] });
    expect(recorded.at(-1)?.outcome).toEqual({ ok: true, detail: "needs_choice" });
    expect(state.dataset.landingPages).toHaveLength(1);

    const pageId = state.dataset.landingPages[0].id;
    const replaced = await POST(request({ file: zipFile(), replacePageId: pageId }));
    expect(await replaced.json()).toMatchObject({ status: "imported", action: "updated", slug: "example-sprint" });
    expect(state.dataset.landingPages).toHaveLength(1);

    const asNew = await POST(request({ file: zipFile(), title: "Cloned Sprint", asNew: "true" }));
    expect(await asNew.json()).toMatchObject({ status: "imported", action: "created", slug: "cloned-sprint" });
    expect(state.dataset.landingPages).toHaveLength(2);
    expect(recorded.map((r) => r.action)).toEqual(Array(4).fill("landing_page_imported"));
    expect(recorded[0].outcome).toEqual({ ok: true, detail: undefined });
  });

  it("reads a file without writing anything when asked to inspect it", async () => {
    const inspected = await POST(request({ file: zipFile(), mode: "inspect" }));
    expect(inspected.status).toBe(200);
    expect(await inspected.json()).toMatchObject({ status: "inspected", suggestedTitle: "Write a little, every day", start: { heading: "Write a little, every day" }, matches: [], pages: [] });
    expect(state.dataset.landingPages).toEqual([]);
    expect(revalidated).toEqual([]);
    expect(recorded.at(-1)?.outcome).toEqual({ ok: true, detail: "inspect" });

    const bad = await POST(request({ file: new File(["hello"], "x.zip"), mode: "inspect" }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ status: "error", error: "That isn't a zip file." });
  });

  it("refuses to replace a page that isn't one an import made", async () => {
    const built = await state.repos.landingPages.create({ title: "Built here", slug: "built-here", createdBy: null });
    const refused = await POST(request({ file: zipFile(), replacePageId: built.id }));
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ status: "error", error: expect.stringContaining("made by an import") });
  });

  it("answers a calm error when the import itself fails", async () => {
    vi.spyOn(state.repos.landingPages, "list").mockRejectedValueOnce(new Error("db down"));
    const failed = await POST(request({ file: zipFile(), title: "A" }));
    expect(failed.status).toBe(400);
    expect(await failed.json()).toEqual({ status: "error", error: "Couldn't import that page. Nothing was lost; try again." });
  });

  it("answers 400 for no file, a file that isn't an export, and a missing title", async () => {
    expect((await POST(request({ title: "A" }))).status).toBe(400);
    const notZip = await POST(request({ file: new File(["hello"], "x.zip"), title: "A" }));
    expect(notZip.status).toBe(400);
    expect(await notZip.json()).toEqual({ status: "error", error: "That isn't a zip file." });
    expect((await POST(request({ file: zipFile(), title: "" }))).status).toBe(400);
    expect(recorded.every((r) => (r.outcome as { ok: boolean }).ok === false)).toBe(true);
  });

  it("refuses a file over the size cap before reading it", async () => {
    const big = new File([new Uint8Array(5 * 1024 * 1024)], "big.zip");
    expect((await POST(request({ file: big, title: "A" }))).status).toBe(413);
  });
});
