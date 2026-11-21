import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { MEMBER_PHOTO } from "@/lib/config";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";

const ADA = "mbr_AAAAAAAAAAA1";
const state: { user: { id: string } | null; identity: { memberId: string; isSudo: boolean } | null; repos: Repos; dataset: InMemoryDataset } = {
  user: { id: "00000000-0000-4000-a000-0000000000a1" },
  identity: { memberId: ADA, isSudo: false },
  repos: undefined as never,
  dataset: undefined as never,
};
const objects = new Map<string, Buffer>();
const revalidated: string[] = [];

vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidated.push(path) }));
vi.mock("@/lib/analytics/server", () => ({ withAction: async (_action: string, run: () => Promise<unknown>) => run() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => state.user }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: async () => state.identity }));
vi.mock("@/lib/data/server", () => ({ getServiceRepos: () => state.repos }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: () => ({
    storage: {
      from: (bucket: string) => {
        expect(bucket).toBe("member-photos");
        return {
          upload: async (path: string, bytes: Buffer, options: { contentType: string }) => {
            expect(options.contentType).toBe("image/webp");
            objects.set(path, bytes);
            return { error: null };
          },
          remove: async (paths: string[]) => {
            for (const p of paths) objects.delete(p);
            return { error: null };
          },
          getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.example.test/member-photos/${path}` } }),
        };
      },
    },
  }),
}));

import { DELETE, POST } from "@/app/api/profile/photo/route";

const picture = (format: "jpeg" | "png" | "gif" = "png") => sharp({ create: { width: 64, height: 64, channels: 3, background: "#48a" } })[format]().toBuffer();
const upload = (file: Blob | string | null, name = "me.png", headers: Record<string, string> = {}) => {
  const body = new FormData();
  if (file !== null) body.append("photo", typeof file === "string" ? file : new File([file as BlobPart], name));
  return new NextRequest("http://localhost/api/profile/photo", { method: "POST", body, headers });
};
const del = () => new NextRequest("http://localhost/api/profile/photo", { method: "DELETE" });
const photoUrl = () => state.dataset.members.find((m) => m.id === ADA)?.photoUrl;

beforeEach(() => {
  state.user = { id: "00000000-0000-4000-a000-0000000000a1" };
  state.identity = { memberId: ADA, isSudo: false };
  state.dataset = new InMemoryDataset({ members: [{ id: ADA, name: "Ada Example", email: "ada@example.test", photoUrl: "https://www.gravatar.com/avatar/abc?d=404" }] });
  state.repos = createInMemoryRepos(state.dataset);
  objects.clear();
  revalidated.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/profile/photo", () => {
  it("stores the member's photo as a small WebP in their folder and points their profile at it", async () => {
    const response = await POST(upload(new Blob([await picture("jpeg")]), "holiday.jpg"));

    expect(response.status).toBe(200);
    const { url } = await response.json();
    const [path, bytes] = [...objects.entries()][0];
    expect(path).toMatch(new RegExp(`^${ADA}/[0-9a-f]{32}\\.webp$`));
    expect((await sharp(bytes).metadata()).format).toBe("webp");
    expect(url).toBe(`https://storage.example.test/member-photos/${path}`);
    expect(photoUrl()).toBe(url);
    expect((await state.repos.memberStatus.profileOverrideOf(ADA))?.photo_path).toBe(path);
    expect(revalidated).toContain(`/members/${ADA}`);
  });

  it("replaces the earlier photo and deletes its file", async () => {
    await POST(upload(new Blob([await picture("png")])));
    const first = [...objects.keys()][0];
    const second = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#a84" } }).png().toBuffer();

    await POST(upload(new Blob([second])));

    expect(objects.has(first)).toBe(false);
    expect(objects.size).toBe(1);
  });

  it("is refused for someone who is not signed in, with no member record, or for staff acting as a member (sudo)", async () => {
    state.user = null;
    expect((await POST(upload(new Blob([await picture()])))).status).toBe(401);
    state.user = { id: "u" };
    state.identity = null;
    expect((await POST(upload(new Blob([await picture()])))).status).toBe(403);
    state.identity = { memberId: ADA, isSudo: true };
    const sudo = await POST(upload(new Blob([await picture()])));
    expect(sudo.status).toBe(403);
    expect((await sudo.json()).error).toMatch(/look at a member's photo, but not change it/);
    expect(objects.size).toBe(0);
    expect(photoUrl()).toContain("gravatar.com");
  });

  it("asks for a photo when none is sent, and refuses a field that is not a file", async () => {
    expect((await POST(upload(null))).status).toBe(400);
    expect((await POST(upload("not a file"))).status).toBe(400);
    expect((await POST(new NextRequest("http://localhost/api/profile/photo", { method: "POST", body: "plain" }))).status).toBe(400);
  });

  it("refuses a file over the limit, by its declared size and by its real size, before decoding it", async () => {
    expect((await POST(upload(new Blob([await picture()]), "a.png", { "content-length": String(MEMBER_PHOTO.maxUploadBytes * 2) }))).status).toBe(413);
    expect((await POST(upload(new Blob([Buffer.alloc(MEMBER_PHOTO.maxUploadBytes + 1)])))).status).toBe(413);
    expect(objects.size).toBe(0);
  });

  it("decides the type from the bytes: a script or text named photo.png, and a GIF, are refused", async () => {
    for (const bytes of [Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>"), Buffer.from("hello"), await picture("gif")]) {
      const response = await POST(upload(new Blob([bytes], { type: "image/png" }), "photo.png"));
      expect(response.status).toBe(400);
    }
    expect(objects.size).toBe(0);
    expect(photoUrl()).toContain("gravatar.com");
  });

  it("only ever writes in the signed-in member's own folder, whatever the file is called", async () => {
    await POST(upload(new Blob([await picture()]), "../../mbr_BBBBBBBBBBB2/evil.png"));
    expect([...objects.keys()].every((path) => path.startsWith(`${ADA}/`) && !path.includes(".."))).toBe(true);
  });

  it("says so when saving fails, and changes nothing", async () => {
    state.repos = { ...state.repos, members: { ...state.repos.members, setPhotoUrl: async () => { throw new Error("db down"); } } } as Repos;
    const response = await POST(upload(new Blob([await picture()])));
    expect(response.status).toBe(500);
    expect((await response.json()).error).toMatch(/Couldn't save your photo/);
  });
});

describe("DELETE /api/profile/photo", () => {
  it("removes the member's own photo and its file, and goes back to the Gravatar address", async () => {
    await POST(upload(new Blob([await picture()])));

    const response = await DELETE(del());

    expect(await response.json()).toEqual({ removed: true });
    expect(objects.size).toBe(0);
    expect((await state.repos.memberStatus.profileOverrideOf(ADA))?.photo_path).toBeNull();
    expect(photoUrl()).toMatch(/^https:\/\/www\.gravatar\.com\/avatar\/[0-9a-f]{32}/);
  });

  it("has nothing to remove for a member whose photo is not their own", async () => {
    expect(await (await DELETE(del())).json()).toEqual({ removed: false });
  });

  it("is refused when not signed in and for sudo", async () => {
    state.user = null;
    expect((await DELETE(del())).status).toBe(401);
    state.user = { id: "u" };
    state.identity = { memberId: ADA, isSudo: true };
    expect((await DELETE(del())).status).toBe(403);
  });

  it("says so when removing fails", async () => {
    await POST(upload(new Blob([await picture()])));
    state.repos = { ...state.repos, members: { ...state.repos.members, byId: async () => { throw new Error("db down"); } } } as Repos;
    expect((await DELETE(del())).status).toBe(500);
  });
});
