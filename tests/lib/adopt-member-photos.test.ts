import { describe, it, expect, beforeEach } from "vitest";
import sharp from "sharp";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryMemberRepository } from "@/lib/data/members";
import { InMemoryMemberStatusRepository } from "@/lib/data/member-status-overrides";
import { KAJABI_PHOTO_HOSTS } from "@/lib/config";
import { applyProfileOverride } from "@/lib/member-profile-overrides";
import { photoUrlFor } from "@/lib/member-photo";
import { adoptMemberPhotos, encodePhoto, isOnHosts, PHOTO_MAX_SIDE, type PhotoStore } from "@/lib/members/adopt-photos";
import type { FetchImageResult } from "@/lib/net/safe-fetch";

const HOST = KAJABI_PHOTO_HOSTS[0];
const kajabi = (name: string) => `https://${HOST}/kajabi-storefronts-production/avatars/${name}.png`;
const OURS = (path: string) => `https://ours.example.test/member-photos/${path}`;
const GRAVATAR = "https://www.gravatar.com/avatar/abc?d=404&s=200";

const ADA = "mbr_AAAAAAAAAAA1";
const FERN = "mbr_AAAAAAAAAAA2";
const GALE = "mbr_AAAAAAAAAAA3";
const HOLLY = "mbr_AAAAAAAAAAA4";

async function png(width = 1200, height = 800, color = "#c0a080") {
  return sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
}

describe("adoptMemberPhotos", () => {
  let data: InMemoryDataset;
  let members: InMemoryMemberRepository;
  let status: InMemoryMemberStatusRepository;
  let uploads: Map<string, Buffer>;
  let store: PhotoStore;
  let fetched: string[];
  let responses: Map<string, FetchImageResult>;

  const deps = () => ({
    members,
    memberStatus: status,
    store,
    hosts: KAJABI_PHOTO_HOSTS,
    fetchImage: async (url: string): Promise<FetchImageResult> => {
      fetched.push(url);
      return responses.get(url) ?? { ok: false, reason: "bad_status", detail: "HTTP 404" };
    },
  });

  beforeEach(async () => {
    data = new InMemoryDataset({
      members: [
        { id: ADA, name: "Ada Example", photoUrl: kajabi("ada") },
        { id: FERN, name: "Fern Example", photoUrl: GRAVATAR },
        { id: GALE, name: "Gale Example", photoUrl: kajabi("gale") },
        { id: HOLLY, name: "Holly Example" },
      ],
    });
    members = new InMemoryMemberRepository(data);
    status = new InMemoryMemberStatusRepository(data);
    uploads = new Map();
    fetched = [];
    store = {
      upload: async (path, bytes) => void uploads.set(path, bytes),
      publicUrl: OURS,
    };
    responses = new Map([
      [kajabi("ada"), { ok: true, bytes: await png(), contentType: "image/png" }],
      [kajabi("gale"), { ok: true, bytes: await png(600, 600, "#102030"), contentType: "image/png" }],
    ]);
  });

  it("copies the photos on the Kajabi host into our storage, shrunk to a WebP, and points the member and their override at it", async () => {
    const report = await adoptMemberPhotos(deps(), { apply: true });

    expect(report).toMatchObject({ dryRun: false, considered: 2, adopted: 2, alreadyAdopted: 0, failedTotal: 0 });
    expect(uploads.size).toBe(2);
    for (const [path, bytes] of uploads) {
      expect(path).toMatch(/^mbr_AAAAAAAAAAA[13]\/[0-9a-f]{32}\.webp$/);
      const meta = await sharp(bytes).metadata();
      expect(meta.format).toBe("webp");
      expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(PHOTO_MAX_SIDE);
    }
    const ada = await members.byId(ADA);
    const override = await status.profileOverrideOf(ADA);
    expect(override?.photo_path).toBeTruthy();
    expect(ada?.photoUrl).toBe(OURS(override!.photo_path!));
    // Other members are untouched.
    expect((await members.byId(FERN))?.photoUrl).toBe(GRAVATAR);
    expect((await members.byId(HOLLY))?.photoUrl).toBeNull();
    expect(await status.profileOverrideOf(FERN)).toBeNull();
  });

  it("writes nothing in a dry run, but still fetches and reports the photos that would not copy", async () => {
    responses.delete(kajabi("gale"));
    const report = await adoptMemberPhotos(deps(), { apply: false });

    expect(report).toMatchObject({ dryRun: true, considered: 2, adopted: 1, failed: { dead_link: 1 }, failedTotal: 1 });
    expect(uploads.size).toBe(0);
    expect((await members.byId(ADA))?.photoUrl).toBe(kajabi("ada"));
    expect(await status.profileOverrideOf(ADA)).toBeNull();
  });

  it("is a no-op the second time", async () => {
    await adoptMemberPhotos(deps(), { apply: true });
    const before = [...uploads.keys()].sort();
    fetched.length = 0;

    const second = await adoptMemberPhotos(deps(), { apply: true });

    expect(second).toMatchObject({ considered: 0, adopted: 0, failedTotal: 0 });
    expect(fetched).toEqual([]);
    expect([...uploads.keys()].sort()).toEqual(before);
  });

  it("leaves a member who has chosen another photo alone", async () => {
    await members.setPhotoUrlIf(ADA, kajabi("ada"), "https://elsewhere.example.test/ada.png");

    const report = await adoptMemberPhotos(deps(), { apply: true });

    expect(report.considered).toBe(1);
    expect(fetched).not.toContain(kajabi("ada"));
    expect((await members.byId(ADA))?.photoUrl).toBe("https://elsewhere.example.test/ada.png");
    expect(await status.profileOverrideOf(ADA)).toBeNull();
  });

  it("takes back the override when the member's photo changed while the run was going", async () => {
    const racing = {
      ...deps(),
      fetchImage: async (url: string): Promise<FetchImageResult> => {
        if (url === kajabi("ada")) await members.setPhotoUrlIf(ADA, kajabi("ada"), "https://elsewhere.example.test/new.png");
        return responses.get(url)!;
      },
    };

    const report = await adoptMemberPhotos(racing, { apply: true });

    expect(report).toMatchObject({ adopted: 1, changedMeanwhile: 1 });
    expect((await members.byId(ADA))?.photoUrl).toBe("https://elsewhere.example.test/new.png");
    expect((await status.profileOverrideOf(ADA))?.photo_path).toBeNull();
  });

  it("repairs a member whose copy exists but whose photo address still points at Kajabi, without fetching again", async () => {
    await status.saveProfileOverride(ADA, { photo_path: `${ADA}/${"a".repeat(32)}.webp` }, null);

    const report = await adoptMemberPhotos(deps(), { apply: true });

    expect(report).toMatchObject({ alreadyAdopted: 1, repaired: 1, adopted: 1 });
    expect(fetched).not.toContain(kajabi("ada"));
    expect((await members.byId(ADA))?.photoUrl).toBe(OURS(`${ADA}/${"a".repeat(32)}.webp`));
  });

  it("reports a dead link and a file that is not an image without stopping, and tries them again next run", async () => {
    responses.set(kajabi("ada"), { ok: false, reason: "bad_status", detail: "HTTP 404" });
    responses.set(kajabi("gale"), { ok: false, reason: "not_image", detail: "not an allowed image type" });

    const first = await adoptMemberPhotos(deps(), { apply: true });
    expect(first).toMatchObject({ adopted: 0, failed: { dead_link: 1, not_image: 1 }, failedTotal: 2 });
    expect(uploads.size).toBe(0);
    expect((await members.byId(ADA))?.photoUrl).toBe(kajabi("ada"));

    responses.set(kajabi("ada"), { ok: true, bytes: await png(), contentType: "image/png" });
    const second = await adoptMemberPhotos(deps(), { apply: true });
    expect(second).toMatchObject({ considered: 2, adopted: 1, failed: { not_image: 1 } });
  });

  it("counts bytes that claim to be an image but do not decode", async () => {
    responses.set(kajabi("ada"), { ok: true, bytes: Buffer.from("not really a picture"), contentType: "image/png" });

    const report = await adoptMemberPhotos(deps(), { apply: true });

    expect(report.failed).toEqual({ unreadable_image: 1 });
    expect(report.adopted).toBe(1);
  });

  it("reports a failed upload and leaves the member on Kajabi", async () => {
    store.upload = async () => {
      throw new Error("bucket missing");
    };

    const report = await adoptMemberPhotos(deps(), { apply: true });

    expect(report.failed).toEqual({ storage: 2 });
    expect((await members.byId(ADA))?.photoUrl).toBe(kajabi("ada"));
    expect(await status.profileOverrideOf(ADA)).toBeNull();
  });

  it("matches the host exactly, over https only", () => {
    expect(isOnHosts(kajabi("x"), KAJABI_PHOTO_HOSTS)).toBe(true);
    expect(isOnHosts(`http://${HOST}/x.png`, KAJABI_PHOTO_HOSTS)).toBe(false);
    expect(isOnHosts(`https://${HOST}.evil.example.test/x.png`, KAJABI_PHOTO_HOSTS)).toBe(false);
    expect(isOnHosts(`https://evil.example.test/${HOST}/x.png`, KAJABI_PHOTO_HOSTS)).toBe(false);
    expect(isOnHosts("not a url", KAJABI_PHOTO_HOSTS)).toBe(false);
  });

  it("encodes small images without enlarging them", async () => {
    const out = await encodePhoto(await png(100, 50));
    const meta = await sharp(out!).metadata();
    expect([meta.width, meta.height]).toEqual([100, 50]);
    expect(await encodePhoto(Buffer.from("nope"))).toBeNull();
  });
});

describe("member processing keeps an adopted photo", () => {
  // What /api/process/members does for each member (app/api/process/members/route.ts, STEP 5.6), without the database.
  const kajabiFields = { bio: null, instagram_url: null, facebook_url: null, twitter_url: null };
  const reprocess = (fromSources: string, override: { photo_path?: string | null } | null) => {
    const member = { ...kajabiFields, photo_url: fromSources as string | null };
    if (override) {
      Object.assign(member, applyProfileOverride(member, override));
      member.photo_url = photoUrlFor(member.photo_url, override, OURS);
    }
    return member.photo_url;
  };

  it("puts our copy back on every run, where the sources would give the Kajabi address again", () => {
    const override = { photo_path: "mbr_AAAAAAAAAAA1/abc.webp" };
    expect(reprocess(kajabi("ada"), override)).toBe(OURS("mbr_AAAAAAAAAAA1/abc.webp"));
    expect(reprocess(kajabi("ada"), override)).toBe(OURS("mbr_AAAAAAAAAAA1/abc.webp"));
  });

  it("follows the sources for a member with no copy", () => {
    expect(reprocess(kajabi("ada"), null)).toBe(kajabi("ada"));
    expect(reprocess(kajabi("ada"), { photo_path: null })).toBe(kajabi("ada"));
  });
});
