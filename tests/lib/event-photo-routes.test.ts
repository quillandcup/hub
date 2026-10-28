import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

// The event photo routes (hide/unhide, the import commit batch, the image proxy) go through
// EventRepository; these run them over the in-memory twin.

let dataset = new InMemoryDataset();
let repos = createInMemoryRepos(dataset);
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

const uploadMock = vi.fn();
const downloadMock = vi.fn();
const roleMock = vi.fn();
const supabase = {
  storage: { from: () => ({ upload: uploadMock, download: downloadMock }) },
  from: () => ({ select: () => ({ eq: () => ({ single: roleMock }) }) }),
};
let auth: { user: { id: string } | null; forbidden?: boolean; supabase: typeof supabase } = { user: { id: "admin" }, supabase };
vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: async () => auth,
  createApiAuth: async () => auth,
}));

const cookieMock = vi.fn();
const clearCookieMock = vi.fn();
vi.mock("@/lib/google-photos-picker/import-session-cookie", () => ({
  getImportSessionCookie: (...a: unknown[]) => cookieMock(...a),
  clearImportSessionCookie: (...a: unknown[]) => clearCookieMock(...a),
}));
const listMock = vi.fn();
const downloadBytesMock = vi.fn();
const deleteSessionMock = vi.fn();
vi.mock("@/lib/google-photos-picker/client", () => ({
  listPickedMediaItems: (...a: unknown[]) => listMock(...a),
  downloadMediaItemBytes: (...a: unknown[]) => downloadBytesMock(...a),
  deletePickerSession: (...a: unknown[]) => deleteSessionMock(...a),
}));

import { PATCH as hidePhoto } from "@/app/api/admin/events/[id]/photos/[photoId]/route";
import { POST as commit } from "@/app/api/admin/events/[id]/photos/import/commit/route";
import { GET as viewPhoto } from "@/app/api/events/[eventId]/photos/[photoId]/route";

const EVENT = "evt_AAAAAAAAAAA1";
const req = (body?: unknown) =>
  new NextRequest("http://localhost/api/x", { method: "PATCH", body: body === undefined ? "{}" : JSON.stringify(body) });

const item = (id: string) => ({ id, createTime: "2097-01-01T00:00:00Z", mediaFile: { baseUrl: "http://b", mimeType: "image/jpeg", filename: `${id}.jpg`, mediaFileMetadata: { width: "10", height: "20" } } });

function failingRepos() {
  const boom = async () => {
    throw new Error("db down");
  };
  overrideEvents({ importedPhotoIds: boom, setPhotoHidden: boom, photoFile: boom });
}

/** The in-memory events repository with some methods replaced (a spread would lose the class's prototype methods). */
function overrideEvents(overrides: Partial<typeof repos.events>) {
  repos = { ...repos, events: Object.assign(Object.create(repos.events), overrides) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  auth = { user: { id: "admin" }, supabase };
  dataset = new InMemoryDataset({
    events: [{ id: EVENT, title: "Retreat", slug: "retreat" }],
    eventPhotos: [{ id: "evph_1", event_id: EVENT, storage_path: `${EVENT}/a.jpg`, google_media_item_id: "a", mime_type: "image/jpeg", hidden_at: null, width: null, height: null, taken_at: null, created_at: "2097-01-01T00:00:00Z" }],
  });
  repos = createInMemoryRepos(dataset);
});

describe("PATCH /api/admin/events/[id]/photos/[photoId]", () => {
  const call = (body: unknown, photoId = "evph_1") => hidePhoto(req(body), { params: Promise.resolve({ id: EVENT, photoId }) });

  it("hides and unhides a photo", async () => {
    const hidden = await call({ hidden: true });
    expect(hidden.status).toBe(200);
    expect((await hidden.json()).photo.hidden_at).toBeTruthy();
    expect(dataset.eventPhotos[0].hidden_at).toBeTruthy();

    const shown = await call({ hidden: false });
    expect((await shown.json()).photo.hidden_at).toBeNull();
  });

  it("rejects the signed-out, non-admins and a body without hidden", async () => {
    auth = { user: null, supabase };
    expect((await call({ hidden: true })).status).toBe(401);
    auth = { user: { id: "m" }, forbidden: true, supabase };
    expect((await call({ hidden: true })).status).toBe(403);
    auth = { user: { id: "admin" }, supabase };
    expect((await call({})).status).toBe(400);
  });

  it("answers 404 for a photo that is not in the event and 500 when the database fails", async () => {
    expect((await call({ hidden: true }, "evph_missing")).status).toBe(404);
    failingRepos();
    const res = await call({ hidden: true });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("db down");
  });
});

describe("POST /api/admin/events/[id]/photos/import/commit", () => {
  const call = () => commit(req(), { params: Promise.resolve({ id: EVENT }) });

  beforeEach(() => {
    cookieMock.mockResolvedValue({ accessToken: "t", sessionId: "s" });
    uploadMock.mockResolvedValue({ error: null });
    downloadBytesMock.mockResolvedValue({ bytes: new Uint8Array([1]), contentType: "image/jpeg" });
  });

  it("imports the picked photos that are not there yet and reports the rest as skipped", async () => {
    listMock.mockResolvedValue([item("a"), item("b")]);

    const res = await call();

    expect(await res.json()).toEqual({ total: 2, imported: 2, skipped: 1, batchImported: 1, remaining: 0 });
    expect(dataset.eventPhotos.map((p) => p.google_media_item_id)).toEqual(["a", "b"]);
    expect(dataset.eventPhotos[1]).toMatchObject({ event_id: EVENT, width: 10, height: 20, mime_type: "image/jpeg" });
    expect(deleteSessionMock).toHaveBeenCalled();
    expect(clearCookieMock).toHaveBeenCalled();
  });

  it("counts a photo whose row cannot be stored as not imported", async () => {
    listMock.mockResolvedValue([item("a"), item("b")]);
    overrideEvents({ addPhoto: async () => { throw new Error("insert failed"); } });

    const body = await (await call()).json();

    expect(body).toMatchObject({ batchImported: 0, remaining: 1 });
    expect(clearCookieMock).not.toHaveBeenCalled();
  });

  it("answers 500 when the already-imported ids cannot be read", async () => {
    listMock.mockResolvedValue([item("b")]);
    failingRepos();
    expect((await call()).status).toBe(500);
  });

  it("needs an import session and an admin", async () => {
    cookieMock.mockResolvedValue(null);
    expect((await call()).status).toBe(409);
    auth = { user: null, supabase };
    expect((await call()).status).toBe(401);
    auth = { user: { id: "m" }, forbidden: true, supabase };
    expect((await call()).status).toBe(403);
  });
});

describe("GET /api/events/[eventId]/photos/[photoId]", () => {
  const call = (photoId = "evph_1") => viewPhoto(new NextRequest("http://localhost/api/x"), { params: Promise.resolve({ eventId: EVENT, photoId }) });
  const blob = { arrayBuffer: async () => new ArrayBuffer(1) };

  beforeEach(() => {
    downloadMock.mockResolvedValue({ data: blob, error: null });
  });

  it("serves a visible photo with its type", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(downloadMock).toHaveBeenCalledWith(`${EVENT}/a.jpg`);
  });

  it("is 401 signed out and 404 for a missing photo, a failed read or a failed download", async () => {
    expect((await call("evph_missing")).status).toBe(404);
    downloadMock.mockResolvedValue({ data: null, error: new Error("gone") });
    expect((await call()).status).toBe(404);
    failingRepos();
    expect((await call()).status).toBe(404);
    auth = { user: null, supabase };
    expect((await call()).status).toBe(401);
  });

  it("shows a hidden photo to admins and the service role only", async () => {
    dataset.eventPhotos[0].hidden_at = "2097-01-02T00:00:00Z";

    auth = { user: { id: "u1" }, supabase };
    roleMock.mockResolvedValue({ data: { role: "member" } });
    expect((await call()).status).toBe(404);

    roleMock.mockResolvedValue({ data: { role: "admin" } });
    expect((await call()).status).toBe(200);

    auth = { user: { id: "service-role" }, supabase };
    expect((await call()).status).toBe(200);
  });
});
