import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { MILESTONE_PHOTO } from "@/lib/config";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";

const ADA = "mbr_AAAAAAAAAAA1";
const BO = "mbr_AAAAAAAAAAA2";
const state: { user: { id: string } | null; identity: { memberId: string; isSudo: boolean } | null; repos: Repos; dataset: InMemoryDataset } = {
  user: { id: "00000000-0000-4000-a000-0000000000a1" },
  identity: { memberId: ADA, isSudo: false },
  repos: undefined as never,
  dataset: undefined as never,
};
const objects = new Map<string, Buffer>();
const revalidated: string[] = [];
const uploads: string[] = [];
let failUpload = false;
let failRemove = false;

vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidated.push(path) }));
vi.mock("@/lib/analytics/server", () => ({ withAction: async (_action: string, run: () => Promise<unknown>) => run() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => state.user }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: async () => state.identity }));
vi.mock("@/lib/data/server", () => ({ getServiceRepos: () => state.repos }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: () => ({
    storage: {
      from: (bucket: string) => {
        expect(bucket).toBe("milestone-photos");
        return {
          upload: async (path: string, bytes: Buffer, options: { contentType: string; upsert: boolean }) => {
            expect(options.contentType).toBe("image/webp");
            if (failUpload) return { error: { message: "storage down" } };
            uploads.push(path);
            objects.set(path, bytes);
            return { error: null };
          },
          remove: async (paths: string[]) => {
            if (failRemove) return { error: { message: "storage down" } };
            for (const p of paths) objects.delete(p);
            return { error: null };
          },
        };
      },
    },
  }),
}));

import { DELETE, POST } from "@/app/api/milestone-photos/route";

const picture = (format: "jpeg" | "png" | "webp" | "gif" = "png", size = 64) => sharp({ create: { width: size, height: size, channels: 3, background: "#48a" } })[format]().toBuffer();
const upload = (file: Blob | string | null, fields: Record<string, string> = {}, headers: Record<string, string> = {}) => {
  const body = new FormData();
  if (file !== null) body.append("photo", typeof file === "string" ? file : new File([file as BlobPart], "me.png"));
  for (const [key, value] of Object.entries(fields)) body.append(key, value);
  return new NextRequest("http://localhost/api/milestone-photos", { method: "POST", body, headers });
};
const del = (query: string) => new NextRequest(`http://localhost/api/milestone-photos${query}`, { method: "DELETE" });

let milestoneId = "";
let bookId = "";
const milestone = () => state.dataset.memberMilestones.find((m) => m.id === milestoneId)!;

beforeEach(async () => {
  state.user = { id: "00000000-0000-4000-a000-0000000000a1" };
  state.identity = { memberId: ADA, isSudo: false };
  state.dataset = new InMemoryDataset({
    members: [
      { id: ADA, name: "Ada Example", email: "ada@example.test" },
      { id: BO, name: "Bo Example", email: "bo@example.test" },
    ],
  });
  state.dataset.memberBooks.push({ id: "book_AAAAAAAAAAA1", member_id: ADA, title: "A Fake Book", published_date: "2026-01-01", cover_asset_id: null });
  state.dataset.memberBooks.push({ id: "book_AAAAAAAAAAA2", member_id: BO, title: "Bo's Fake Book", published_date: "2026-01-01", cover_asset_id: null });
  bookId = "book_AAAAAAAAAAA1";
  state.repos = createInMemoryRepos(state.dataset);
  const answer = { status: "confirmed" as const, achievedOn: null, achievedPrecision: "day" as const, storyBefore: null, storyAfter: null, consent_testimonial: false };
  milestoneId = (await state.repos.milestones.addOwn({ memberId: ADA, kind: "the_end", answer, work: { projectId: null, bookId: null, title: "A Fake Novel" }, createdBy: "u" }, new Date())).milestone.id;
  objects.clear();
  uploads.length = 0;
  revalidated.length = 0;
  failUpload = false;
  failRemove = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/milestone-photos", () => {
  it("stores the photo as a WebP in the member's own folder under a random name, and puts only the path on the milestone", async () => {
    const response = await POST(upload(new Blob([await picture("jpeg")]), { target: "milestone", id: milestoneId, alt: "  At my   desk " }));

    expect(response.status).toBe(200);
    const { token, alt } = await response.json();
    expect(alt).toBe("At my desk");
    const [path, bytes] = [...objects.entries()][0];
    expect(path).toBe(`${ADA}/${token}.webp`);
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect((await sharp(bytes).metadata()).format).toBe("webp");
    expect(milestone()).toMatchObject({ photo_path: path, photo_alt: "At my desk" });
    expect(revalidated).toContain(`/members/${ADA}`);
  });

  it("gives a new random address to a replacement, deletes the old file, and forgets the old description", async () => {
    await POST(upload(new Blob([await picture("png")]), { target: "milestone", id: milestoneId, alt: "First" }));
    const first = [...objects.keys()][0];

    const second = await POST(upload(new Blob([await picture("png", 32)]), { target: "milestone", id: milestoneId }));

    expect(second.status).toBe(200);
    expect(objects.has(first)).toBe(false);
    expect(objects.size).toBe(1);
    expect([...objects.keys()][0]).not.toBe(first);
    expect(milestone().photo_alt).toBeNull();
  });

  it("puts the 'holding my book' photo on the member's own Bookshelf book", async () => {
    const response = await POST(upload(new Blob([await picture("webp")]), { target: "book", id: bookId, alt: "Holding it" }));

    expect(response.status).toBe(200);
    const [path] = [...objects.keys()];
    expect(path.startsWith(`${ADA}/`)).toBe(true);
    expect(state.dataset.memberBookPhotos).toMatchObject([{ book_id: bookId, member_id: ADA, photo_path: path, photo_alt: "Holding it" }]);
  });

  it("shrinks a large picture to the longest side in the config, and strips EXIF, including where it was taken", async () => {
    const source = await sharp({ create: { width: MILESTONE_PHOTO.maxEdge * 2, height: 100, channels: 3, background: "#7a4" } })
      .withExif({ IFD0: { Copyright: "Ada Example", ImageDescription: "taken at a secret place" }, IFD3: { GPSLatitudeRef: "N" } })
      .jpeg()
      .toBuffer();
    expect((await sharp(source).metadata()).exif).toBeDefined();
    expect(source.byteLength).toBeLessThan(MILESTONE_PHOTO.maxUploadBytes);

    expect((await POST(upload(new Blob([source]), { target: "milestone", id: milestoneId }))).status).toBe(200);

    const stored = [...objects.values()][0];
    const meta = await sharp(stored).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(MILESTONE_PHOTO.maxEdge);
    expect(meta.exif).toBeUndefined();
    expect(stored.includes(Buffer.from("secret place"))).toBe(false);
    expect(stored.includes(Buffer.from("Ada Example"))).toBe(false);
  });

  it("is refused for someone not signed in, with no member record, or for staff acting as a member (sudo), and nothing is stored", async () => {
    const photo = new Blob([await picture()]);
    state.user = null;
    expect((await POST(upload(photo, { target: "milestone", id: milestoneId }))).status).toBe(401);
    state.user = { id: "u" };
    state.identity = null;
    expect((await POST(upload(photo, { target: "milestone", id: milestoneId }))).status).toBe(403);
    state.identity = { memberId: ADA, isSudo: true };
    const sudo = await POST(upload(photo, { target: "milestone", id: milestoneId }));
    expect(sudo.status).toBe(403);
    expect((await sudo.json()).error).toMatch(/look at a member's photos, but not change them/);
    expect(objects.size).toBe(0);
    expect(milestone().photo_path).toBeNull();
  });

  it("is not found for another member's milestone or book, a milestone that is not confirmed, or one that does not exist", async () => {
    const photo = new Blob([await picture()]);
    state.identity = { memberId: BO, isSudo: false };
    expect((await POST(upload(photo, { target: "milestone", id: milestoneId }))).status).toBe(404);
    expect((await POST(upload(photo, { target: "book", id: bookId }))).status).toBe(404);
    state.identity = { memberId: ADA, isSudo: false };
    expect((await POST(upload(photo, { target: "milestone", id: "mlst_ZZZZZZZZZZZZ" }))).status).toBe(404);
    await state.repos.milestones.answer(milestoneId, ADA, { status: "declined" }, new Date());
    expect((await POST(upload(photo, { target: "milestone", id: milestoneId }))).status).toBe(404);
    expect(objects.size).toBe(0);
    expect(state.dataset.memberBookPhotos).toEqual([]);
  });

  it("asks for what is missing: a target and an id, a photo, a field that is a file", async () => {
    const photo = new Blob([await picture()]);
    expect((await POST(upload(photo, { target: "milestone" }))).status).toBe(400);
    expect((await POST(upload(photo, { target: "elsewhere", id: milestoneId }))).status).toBe(400);
    expect((await POST(upload(null, { target: "milestone", id: milestoneId }))).status).toBe(400);
    expect((await POST(upload("not a file", { target: "milestone", id: milestoneId }))).status).toBe(400);
    expect((await POST(new NextRequest("http://localhost/api/milestone-photos", { method: "POST", body: "plain" }))).status).toBe(400);
  });

  it("refuses a file that is too large, declared or real, and a description that is too long", async () => {
    const declared = await POST(upload(new Blob([await picture()]), { target: "milestone", id: milestoneId }, { "content-length": String(MILESTONE_PHOTO.maxUploadBytes + 1024 * 1024) }));
    expect(declared.status).toBe(413);
    const huge = new Blob([new Uint8Array(MILESTONE_PHOTO.maxUploadBytes + 1)]);
    expect((await POST(upload(huge, { target: "milestone", id: milestoneId }))).status).toBe(413);
    const longAlt = await POST(upload(new Blob([await picture()]), { target: "milestone", id: milestoneId, alt: "x".repeat(MILESTONE_PHOTO.altMaxLength + 1) }));
    expect(longAlt.status).toBe(400);
    expect(objects.size).toBe(0);
  });

  it("refuses what is not a JPEG, PNG or WebP picture, whatever it is called: an animation, text, a script, an SVG", async () => {
    const refuse = async (bytes: Buffer | Uint8Array) => {
      const response = await POST(upload(new Blob([new Uint8Array(bytes)]), { target: "milestone", id: milestoneId }));
      expect(response.status).toBe(400);
    };
    await refuse(await picture("gif"));
    await refuse(Buffer.from("just some words, called me.png"));
    await refuse(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
    await refuse(Buffer.from("<?php echo 1;"));
    expect(objects.size).toBe(0);
    expect(milestone().photo_path).toBeNull();
  });

  it("deletes the file it stored when the milestone was taken back in between, and says so", async () => {
    const repo = state.repos.milestones;
    const original = repo.setPhoto.bind(repo);
    vi.spyOn(repo, "setPhoto").mockImplementation(async (...args) => {
      await repo.takeBack(milestoneId, ADA, new Date());
      return original(...args);
    });

    const response = await POST(upload(new Blob([await picture()]), { target: "milestone", id: milestoneId }));

    expect(response.status).toBe(404);
    expect(objects.size).toBe(0);
  });

  it("reports a storage failure without touching the milestone, and cleans up when saving the row fails", async () => {
    failUpload = true;
    expect((await POST(upload(new Blob([await picture()]), { target: "milestone", id: milestoneId }))).status).toBe(500);
    expect(milestone().photo_path).toBeNull();

    failUpload = false;
    vi.spyOn(state.repos.milestones, "setPhoto").mockRejectedValue(new Error("database down"));
    expect((await POST(upload(new Blob([await picture()]), { target: "milestone", id: milestoneId }))).status).toBe(500);
    expect(objects.size).toBe(0);
  });
});

describe("DELETE /api/milestone-photos", () => {
  it("takes the photo off the milestone and deletes its file", async () => {
    await POST(upload(new Blob([await picture()]), { target: "milestone", id: milestoneId, alt: "Desk" }));
    expect(objects.size).toBe(1);

    const response = await DELETE(del(`?target=milestone&id=${milestoneId}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ removed: true });
    expect(objects.size).toBe(0);
    expect(milestone()).toMatchObject({ photo_path: null, photo_alt: null });
  });

  it("takes the photo off a book", async () => {
    await POST(upload(new Blob([await picture()]), { target: "book", id: bookId }));

    expect((await DELETE(del(`?target=book&id=${bookId}`))).status).toBe(200);

    expect(objects.size).toBe(0);
    expect(state.dataset.memberBookPhotos).toEqual([]);
    expect((await DELETE(del(`?target=book&id=${bookId}`))).status).toBe(404);
  });

  it("says nothing was removed for a milestone that has no photo, and is not found for another member's or an unknown one", async () => {
    expect(await (await DELETE(del(`?target=milestone&id=${milestoneId}`))).json()).toEqual({ removed: false });
    expect((await DELETE(del("?target=milestone&id=mlst_ZZZZZZZZZZZZ"))).status).toBe(404);
    await POST(upload(new Blob([await picture()]), { target: "milestone", id: milestoneId }));
    state.identity = { memberId: BO, isSudo: false };
    expect((await DELETE(del(`?target=milestone&id=${milestoneId}`))).status).toBe(404);
    expect(objects.size).toBe(1);
  });

  it("is refused for someone not signed in, and for staff acting as a member (sudo)", async () => {
    await POST(upload(new Blob([await picture()]), { target: "milestone", id: milestoneId }));
    state.user = null;
    expect((await DELETE(del(`?target=milestone&id=${milestoneId}`))).status).toBe(401);
    state.user = { id: "u" };
    state.identity = { memberId: ADA, isSudo: true };
    expect((await DELETE(del(`?target=milestone&id=${milestoneId}`))).status).toBe(403);
    expect(objects.size).toBe(1);
  });

  it("asks for a target and an id, and reports a failure", async () => {
    expect((await DELETE(del(""))).status).toBe(400);
    expect((await DELETE(del("?target=milestone"))).status).toBe(400);
    vi.spyOn(state.repos.milestones, "removePhoto").mockRejectedValue(new Error("database down"));
    expect((await DELETE(del(`?target=milestone&id=${milestoneId}`))).status).toBe(500);
  });

  it("still removes the row's photo when the file cannot be deleted (a leftover file is unreachable)", async () => {
    await POST(upload(new Blob([await picture()]), { target: "milestone", id: milestoneId }));
    failRemove = true;
    expect((await DELETE(del(`?target=milestone&id=${milestoneId}`))).status).toBe(200);
    expect(milestone().photo_path).toBeNull();
  });
});
