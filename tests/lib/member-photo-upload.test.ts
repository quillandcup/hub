import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { MEMBER_PHOTO } from "@/lib/config";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { gravatarUrl } from "@/lib/member-avatar";
import { publishablePhotoUrl } from "@/lib/writer-profile";
import type { FetchImageResult } from "@/lib/net/safe-fetch";
import {
  copyGravatarPhoto,
  isGravatarAddress,
  photoPathFor,
  photoSource,
  prepareUpload,
  removeMemberPhoto,
  replaceMemberPhoto,
  type MemberPhotoStore,
} from "@/lib/members/photo";

const ADA = "mbr_AAAAAAAAAAA1";
const GRACE = "mbr_AAAAAAAAAAA2";
const USER = "00000000-0000-4000-a000-0000000000a1";

let dataset: InMemoryDataset;
const objects = new Map<string, Buffer>();
const removed: string[] = [];
const store: MemberPhotoStore = {
  upload: async (path, bytes) => void objects.set(path, bytes),
  remove: async (path) => {
    removed.push(path);
    objects.delete(path);
  },
  publicUrl: (path) => `https://storage.example.test/member-photos/${path}`,
};
const deps = () => {
  const repos = createInMemoryRepos(dataset);
  return { members: repos.members, memberStatus: repos.memberStatus, store };
};
const photoUrlOf = (id: string) => dataset.members.find((m) => m.id === id)?.photoUrl;

const picture = (format: "jpeg" | "png" | "webp" | "gif", size = 8, extra: { exif?: boolean } = {}) => {
  let image = sharp({ create: { width: size, height: extra.exif ? size / 2 : size, channels: 3, background: "#7a4" } });
  if (extra.exif) image = image.withExif({ IFD0: { Copyright: "Ada Example", ImageDescription: "taken at a secret place" } }).withMetadata({ orientation: 6 });
  return image[format]().toBuffer();
};

beforeEach(() => {
  objects.clear();
  removed.length = 0;
  dataset = new InMemoryDataset({
    members: [
      { id: ADA, name: "Ada Example", email: "ada@example.test", photoUrl: "https://www.gravatar.com/avatar/0123?d=404&s=200" },
      { id: GRACE, name: "Grace Example", email: "grace@example.test" },
    ],
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("prepareUpload", () => {
  it.each(["jpeg", "png", "webp"] as const)("takes a %s and makes a small WebP", async (format) => {
    const result = await prepareUpload(await picture(format, 1200));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const meta = await sharp(result.encoded).metadata();
    expect(meta.format).toBe("webp");
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(512);
  });

  it("drops EXIF, including where the photo was taken, and turns the picture upright", async () => {
    const source = await picture("jpeg", 40, { exif: true });
    expect((await sharp(source).metadata()).exif).toBeDefined();

    const result = await prepareUpload(source);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const meta = await sharp(result.encoded).metadata();
    expect(meta.exif).toBeUndefined();
    expect(result.encoded.includes(Buffer.from("secret place"))).toBe(false);
    // An orientation of 6 turns a 40 by 20 picture a quarter: the file is now as it looks.
    expect([meta.width, meta.height]).toEqual([20, 40]);
  });

  it("decides what a file is from its bytes, not its name: text and SVG are refused", async () => {
    for (const bytes of [Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"), Buffer.from("just some text, called photo.png"), Buffer.from("GIF"), Buffer.from("%PDF-1.4")]) {
      const result = await prepareUpload(bytes);
      expect(result).toEqual({ ok: false, error: expect.stringMatching(/JPEG, PNG or WebP/) });
    }
  });

  it("refuses a GIF, which is an image but not one of the three", async () => {
    expect(await prepareUpload(await picture("gif"))).toEqual({ ok: false, error: "Use a JPEG, PNG or WebP photo." });
  });

  it("refuses an empty file and one over the limit", async () => {
    expect(await prepareUpload(Buffer.alloc(0))).toEqual({ ok: false, error: "That file is empty." });
    const result = await prepareUpload(Buffer.alloc(MEMBER_PHOTO.maxUploadBytes + 1));
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/MB or less/) });
  });
});

describe("where a photo is kept", () => {
  it("is the member's own folder, named by the bytes, and a Gravatar copy says so", () => {
    const bytes = Buffer.from("same bytes");
    expect(photoPathFor(ADA, bytes, "upload")).toMatch(new RegExp(`^${ADA}/[0-9a-f]{32}\\.webp$`));
    expect(photoPathFor(ADA, bytes, "upload")).toBe(photoPathFor(ADA, bytes, "upload"));
    expect(photoPathFor(ADA, bytes, "upload")).not.toBe(photoPathFor(ADA, Buffer.from("other"), "upload"));
    expect(photoPathFor(ADA, bytes, "gravatar")).toMatch(new RegExp(`^${ADA}/gravatar-[0-9a-f]{32}\\.webp$`));
  });

  it("says where a photo comes from", () => {
    expect(photoSource(null, null)).toBe("none");
    expect(photoSource("https://x.test/a.webp", `${ADA}/abc.webp`)).toBe("uploaded");
    expect(photoSource("https://x.test/a.webp", `${ADA}/gravatar-abc.webp`)).toBe("gravatar_copy");
    expect(photoSource("https://www.gravatar.com/avatar/abc?d=404", null)).toBe("gravatar");
    expect(photoSource("https://storage.example.test/slack-avatars/U1/a.png", null)).toBe("slack");
    expect(photoSource("https://kajabi-storefronts-production.kajabi-cdn.com/a.png", null)).toBe("kajabi");
    expect(photoSource("https://photos.example.com/a.png", null)).toBe("other");
  });

  it("knows a Gravatar address", () => {
    expect(isGravatarAddress("https://secure.gravatar.com/avatar/abc")).toBe(true);
    expect(isGravatarAddress("https://photos.example.com/avatar/abc")).toBe(false);
    expect(isGravatarAddress("not a url")).toBe(false);
    expect(isGravatarAddress(null)).toBe(false);
  });
});

describe("replaceMemberPhoto and removeMemberPhoto", () => {
  it("stores the photo, remembers it for processing and points the member at it", async () => {
    const encoded = Buffer.from("webp one");

    const url = await replaceMemberPhoto(deps(), ADA, encoded, "upload", USER);

    const path = photoPathFor(ADA, encoded, "upload");
    expect(objects.get(path)).toEqual(encoded);
    expect(url).toBe(`https://storage.example.test/member-photos/${path}`);
    expect(photoUrlOf(ADA)).toBe(url);
    expect((await createInMemoryRepos(dataset).memberStatus.profileOverrideOf(ADA))?.photo_path).toBe(path);
  });

  it("replaces the old copy and deletes its file, but leaves the file alone when the picture is the same", async () => {
    await replaceMemberPhoto(deps(), ADA, Buffer.from("webp one"), "upload", USER);
    const first = photoPathFor(ADA, Buffer.from("webp one"), "upload");

    await replaceMemberPhoto(deps(), ADA, Buffer.from("webp one"), "upload", USER);
    expect(removed).toEqual([]);
    expect(objects.has(first)).toBe(true);

    await replaceMemberPhoto(deps(), ADA, Buffer.from("webp two"), "upload", USER);
    expect(removed).toEqual([first]);
    expect([...objects.keys()]).toEqual([photoPathFor(ADA, Buffer.from("webp two"), "upload")]);
  });

  it("keeps the new photo when deleting the old file fails", async () => {
    await replaceMemberPhoto(deps(), ADA, Buffer.from("webp one"), "upload", USER);
    const failing = { ...deps(), store: { ...store, remove: async () => { throw new Error("storage down"); } } };

    await expect(replaceMemberPhoto(failing, ADA, Buffer.from("webp two"), "upload", USER)).resolves.toContain(photoPathFor(ADA, Buffer.from("webp two"), "upload"));
    expect(photoUrlOf(ADA)).toContain(photoPathFor(ADA, Buffer.from("webp two"), "upload"));
  });

  it("removes the photo: forgets it, deletes the file and goes back to the Gravatar address", async () => {
    await replaceMemberPhoto(deps(), ADA, Buffer.from("webp one"), "upload", USER);

    expect(await removeMemberPhoto(deps(), ADA, "Ada@Example.test ", USER)).toBe(true);

    expect(objects.size).toBe(0);
    expect((await createInMemoryRepos(dataset).memberStatus.profileOverrideOf(ADA))?.photo_path).toBeNull();
    expect(photoUrlOf(ADA)).toBe(gravatarUrl("ada@example.test"));
  });

  it("has nothing to remove for a member with no photo of their own, and changes nothing", async () => {
    const before = photoUrlOf(ADA);
    expect(await removeMemberPhoto(deps(), ADA, "ada@example.test", USER)).toBe(false);
    expect(photoUrlOf(ADA)).toBe(before);
    expect(removed).toEqual([]);
  });
});

describe("copyGravatarPhoto", () => {
  const found = async (): Promise<FetchImageResult> => ({ ok: true, bytes: await picture("jpeg", 300), contentType: "image/jpeg" });

  it("fetches the member's own Gravatar once, from the one host, and stores a copy that is not at a Gravatar address", async () => {
    const fetchOne = vi.fn(async (_url: string) => found());

    const result = await copyGravatarPhoto(deps(), ADA, "ada@example.test", USER, fetchOne);

    expect(result).toEqual({ ok: true });
    expect(fetchOne).toHaveBeenCalledTimes(1);
    const asked = new URL(fetchOne.mock.calls[0][0]);
    expect(asked.protocol).toBe("https:");
    expect(asked.hostname).toBe(MEMBER_PHOTO.gravatarHost);
    expect(asked.pathname).toMatch(/^\/avatar\/[0-9a-f]{32}$/);
    expect(asked.searchParams.get("d")).toBe("404");
    const path = (await createInMemoryRepos(dataset).memberStatus.profileOverrideOf(ADA))?.photo_path;
    expect(path).toMatch(new RegExp(`^${ADA}/gravatar-[0-9a-f]{32}\\.webp$`));
    expect(photoUrlOf(ADA)).toBe(`https://storage.example.test/member-photos/${path}`);
    expect(photoSource(photoUrlOf(ADA), path)).toBe("gravatar_copy");
    // What the public read would carry is our copy, never an address with the email hash.
    expect(publishablePhotoUrl(photoUrlOf(ADA))).toBe(photoUrlOf(ADA));
    expect(photoUrlOf(ADA)).not.toMatch(/gravatar\.com/);
  });

  it("finds no Gravatar when the address answers 404, stores nothing and says so", async () => {
    const fetchOne = async (): Promise<FetchImageResult> => ({ ok: false, reason: "bad_status", detail: "404", status: 404 });

    expect(await copyGravatarPhoto(deps(), GRACE, "grace@example.test", USER, fetchOne)).toEqual({ ok: false, reason: "none" });
    expect(objects.size).toBe(0);
    expect(await createInMemoryRepos(dataset).memberStatus.profileOverrideOf(GRACE)).toBeNull();
  });

  it.each([
    ["a server error", { ok: false, reason: "bad_status", detail: "500", status: 500 }],
    ["a response over the size cap", { ok: false, reason: "too_large", detail: "too big" }],
    ["a response that is not an image", { ok: false, reason: "not_image", detail: "not an allowed image type" }],
    ["a timeout", { ok: false, reason: "timeout", detail: "slow" }],
  ] as const)("fails without storing anything for %s", async (_name, answer) => {
    const result = await copyGravatarPhoto(deps(), ADA, "ada@example.test", USER, async () => answer as FetchImageResult);

    expect(result).toEqual({ ok: false, reason: "failed" });
    expect(objects.size).toBe(0);
    expect(photoUrlOf(ADA)).toContain("gravatar.com");
  });

  it("fails when the bytes are not a picture after all, or the store is down", async () => {
    const junk = async (): Promise<FetchImageResult> => ({ ok: true, bytes: Buffer.from("not a picture at all"), contentType: "image/png" });
    expect(await copyGravatarPhoto(deps(), ADA, "ada@example.test", USER, junk)).toEqual({ ok: false, reason: "failed" });

    const down = { ...deps(), store: { ...store, upload: async () => { throw new Error("storage down"); } } };
    expect(await copyGravatarPhoto(down, ADA, "ada@example.test", USER, found)).toEqual({ ok: false, reason: "failed" });
    expect(photoUrlOf(ADA)).toContain("gravatar.com");
  });

  it("hashes the email the way Gravatar does, whatever its case or spaces", async () => {
    const urls: string[] = [];
    const record = async (url: string) => (urls.push(url), await found());
    await copyGravatarPhoto(deps(), ADA, "  ADA@Example.test", USER, record);
    await copyGravatarPhoto(deps(), ADA, "ada@example.test", USER, record);
    expect(new URL(urls[0]).pathname).toBe(new URL(urls[1]).pathname);
  });
});
