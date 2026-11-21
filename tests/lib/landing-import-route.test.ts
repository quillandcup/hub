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

  it("imports an export as a draft, then updates it, and records both", async () => {
    const created = await POST(request({ file: zipFile(), title: "Example Sprint" }));
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({ status: "imported", action: "created", slug: "example-sprint" });
    expect(state.dataset.landingPages).toHaveLength(1);
    expect(revalidated).toContain("/admin/pages");

    const again = await POST(request({ file: zipFile(), title: "Example Sprint" }));
    expect(await again.json()).toMatchObject({ status: "imported", action: "updated" });
    expect(state.dataset.landingPages).toHaveLength(1);
    expect(recorded.map((r) => r.action)).toEqual(["landing_page_imported", "landing_page_imported"]);
    expect(recorded[0].outcome).toEqual({ ok: true, detail: undefined });
  });

  it("asks for confirmation (and records that) instead of replacing an edited draft", async () => {
    await POST(request({ file: zipFile(), title: "Example Sprint" }));
    const page = state.dataset.landingPages[0];
    await new Promise((r) => setTimeout(r, 5));
    await state.repos.landingPages.saveDraft(page.id, { content: [], root: {} }, null);

    const asked = await POST(request({ file: zipFile(), title: "Example Sprint" }));
    expect(await asked.json()).toMatchObject({ status: "confirm", existing: { slug: "example-sprint" } });
    expect(recorded.at(-1)?.outcome).toEqual({ ok: true, detail: "needs_confirm" });

    const done = await POST(request({ file: zipFile(), title: "Example Sprint", confirm: "true" }));
    expect(await done.json()).toMatchObject({ status: "imported", action: "updated", keptBefore: false }); // the replaced draft was empty
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
