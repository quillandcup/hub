import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = vi.hoisted(() => ({ result: { user: { id: "u" }, forbidden: false } as { user: { id: string } | null; forbidden: boolean } }));
vi.mock("@/lib/supabase/api-auth", () => ({ requireApiPermission: async () => auth.result }));
const copy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({ storage: { from: () => ({ copy }) } }) }));
vi.mock("@/lib/data/repos", () => ({ createRepos: () => ({ marker: "repos" }) }));
const importer = vi.hoisted(() => vi.fn());
vi.mock("@/lib/courses/quiz-response-import", async (orig) => ({ ...(await orig<typeof import("@/lib/courses/quiz-response-import")>()), importKajabiQuizResponses: importer }));

const { POST } = await import("@/app/api/process/quiz-responses/route");
const { QuizResponseImportError } = await import("@/lib/courses/quiz-response-import");

const call = (body: unknown) => POST(new NextRequest("http://localhost/api/process/quiz-responses", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

beforeEach(() => {
  auth.result = { user: { id: "u" }, forbidden: false };
  importer.mockReset().mockResolvedValue({ dryRun: false, courses: [{ slug: "academy" }] });
  copy.mockReset().mockResolvedValue({ error: null });
});

describe("POST /api/process/quiz-responses", () => {
  it("refuses a caller who isn't signed in or isn't allowed, without reading anything", async () => {
    auth.result = { user: null, forbidden: false };
    expect((await call({})).status).toBe(401);
    auth.result = { user: { id: "u" }, forbidden: true };
    expect((await call({})).status).toBe(403);
    expect(importer).not.toHaveBeenCalled();
  });

  it("runs the import for a course, or for every course, and a dry run on request, and returns its counts", async () => {
    const response = await call({ course: "academy", dryRun: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, dryRun: false, courses: [{ slug: "academy" }] });
    expect(importer).toHaveBeenCalledWith({ marker: "repos" }, expect.objectContaining({ copyFile: expect.any(Function), randomId: expect.any(Function) }), { courseSlug: "academy", dryRun: true });
    await call({});
    expect(importer).toHaveBeenLastCalledWith({ marker: "repos" }, expect.anything(), { courseSlug: undefined, dryRun: false });
  });

  it("copies a file inside the private answer-files bucket, and says false when storage refuses", async () => {
    await call({});
    const deps = importer.mock.calls[0][1] as { copyFile: (a: string, b: string) => Promise<boolean>; randomId: () => string };
    expect(await deps.copyFile("kajabi-import/a/b/c.pdf", "mbr_x/y/c.pdf")).toBe(true);
    expect(copy).toHaveBeenCalledWith("kajabi-import/a/b/c.pdf", "mbr_x/y/c.pdf");
    expect(deps.randomId()).toMatch(/^[0-9a-f-]{36}$/);
    copy.mockResolvedValue({ error: { message: "no" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await deps.copyFile("a", "b")).toBe(false);
    spy.mockRestore();
  });

  it("answers 400 for a body that isn't JSON, the import's own status for an unknown course, and 500 for anything else", async () => {
    expect((await call("{nope")).status).toBe(400);
    importer.mockRejectedValueOnce(new QuizResponseImportError('No Kajabi course has the slug "x"', 404));
    expect((await call({ course: "x" })).status).toBe(404);
    importer.mockRejectedValueOnce(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failed = await call({});
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "db down" });
    spy.mockRestore();
  });
});
