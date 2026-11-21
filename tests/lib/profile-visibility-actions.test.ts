import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";

const ADA = "mbr_AAAAAAAAAAA1";
const GRACE = "mbr_AAAAAAAAAAA2";
const AT = "2027-01-01T00:00:00Z";

const state: { user: { id: string; email: string } | null; identity: { memberId: string; isSudo: boolean } | null; repos: Repos; dataset: InMemoryDataset } = {
  user: { id: "00000000-0000-4000-a000-0000000000a1", email: "ada@example.test" },
  identity: { memberId: ADA, isSudo: false },
  repos: undefined as never,
  dataset: undefined as never,
};
const revalidated: string[] = [];

vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidated.push(path) }));
vi.mock("@/lib/analytics/server", () => ({ withAction: async (_action: string, run: () => Promise<unknown>) => run() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => state.user }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: async () => state.identity }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/data/repos", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/data/repos")>()), createRepos: () => state.repos }));
vi.mock("@/lib/data/server", () => ({ getServiceRepos: () => state.repos }));
const uploaded: string[] = [];
vi.mock("@/lib/net/safe-fetch", () => ({ fetchImage: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: () => ({
    storage: {
      from: () => ({
        upload: async (path: string) => (uploaded.push(path), { error: null }),
        remove: async () => ({ error: null }),
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.example.test/member-photos/${path}` } }),
      }),
    },
  }),
}));

import sharp from "sharp";
import { fetchImage, type FetchImageResult } from "@/lib/net/safe-fetch";
import { MEMBER_PHOTO } from "@/lib/config";

import { setProfileVisibility } from "@/app/(member)/settings/profileVisibilityActions";
import { WRITER_PROFILES_NOT_AVAILABLE } from "@/lib/writer-profiles-access";

const flagRow = (enabled_globally: boolean) => ({ feature_key: "writer_profiles", enabled_globally, created_at: AT, updated_at: AT });

beforeEach(() => {
  state.user = { id: "00000000-0000-4000-a000-0000000000a1", email: "ada@example.test" };
  state.identity = { memberId: ADA, isSudo: false };
  state.dataset = new InMemoryDataset({
    members: [
      { id: ADA, name: "Ada Legalname", displayName: "Ada Example", photoUrl: "https://photos.example.com/ada.png", userId: "user-ada" },
      { id: GRACE, name: "Grace Example", photoUrl: "https://secure.gravatar.com/avatar/0123456789abcdef", userId: "user-grace" },
    ],
    featureFlags: [flagRow(true)],
  });
  state.repos = createInMemoryRepos(state.dataset);
  revalidated.length = 0;
  uploaded.length = 0;
  vi.mocked(fetchImage).mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("setProfileVisibility", () => {
  it("refuses someone who is not signed in or has no member record, and writes nothing", async () => {
    state.user = null;
    expect(await setProfileVisibility("bio", "private")).toEqual({ error: "Not authenticated" });
    state.user = { id: "u", email: "a@example.test" };
    state.identity = null;
    expect(await setProfileVisibility("bio", "private")).toEqual({ error: "No member record" });
    expect(state.dataset.memberProfileOverrides).toEqual([]);
  });

  it("saves a level for a web item, keeps the others at community, and refreshes what shows it", async () => {
    expect(await setProfileVisibility("bio", "private")).toEqual({ success: true });

    expect(await state.repos.memberStatus.profileVisibilitiesOf(ADA)).toEqual({ bio: "private", photo: "community", instagram: "community", facebook: "community", x: "community" });
    expect(state.dataset.memberProfileOverrides[0]).toMatchObject({ member_id: ADA, updated_by: state.user!.id });
    expect(revalidated).toEqual(expect.arrayContaining(["/settings", "/members", `/members/${ADA}`]));
  });

  it("refuses an item that is not on the profile and a level that does not exist, and writes nothing", async () => {
    expect(await setProfileVisibility("email", "private")).toEqual({ error: expect.stringContaining("not something on your profile") });
    expect(await setProfileVisibility("bio", "everyone")).toEqual({ error: expect.stringContaining("not available") });
    expect(await setProfileVisibility("bio", "")).toHaveProperty("error");
    expect(state.dataset.memberProfileOverrides).toEqual([]);
  });

  it("never offers the globe on the topics, which the page does not show, but saves private and community", async () => {
    expect(await setProfileVisibility("ask_me_about", "public")).toEqual({ error: expect.stringContaining("not available") });
    expect(await state.repos.memberProfile.askMeAboutOf(ADA)).toMatchObject({ visibility: "community" });

    expect(await setProfileVisibility("ask_me_about", "private")).toEqual({ success: true });
    expect(await state.repos.memberProfile.askMeAboutOf(ADA)).toMatchObject({ visibility: "private" });
    expect(await state.repos.memberProfile.askMeAbout(ADA, GRACE)).toEqual([]);
  });

  it("refuses the globe when pages on the web are not open to the member, but still lets a public item be taken back", async () => {
    state.dataset.featureFlags = [flagRow(false)];
    expect(await setProfileVisibility("bio", "public")).toEqual({ error: WRITER_PROFILES_NOT_AVAILABLE });
    expect(state.dataset.memberProfileOverrides).toEqual([]);

    await state.repos.memberStatus.saveProfileVisibility(ADA, "bio", "public", null);
    expect(await setProfileVisibility("bio", "community")).toEqual({ success: true });
    expect((await state.repos.memberStatus.profileVisibilitiesOf(ADA)).bio).toBe("community");
  });

  it("allows the globe when the flag is on for the member through their own preview", async () => {
    state.dataset.featureFlags = [flagRow(false)];
    state.dataset.userFeaturePreviews = [{ user_id: "user-ada", feature_key: "writer_profiles", enabled_at: AT }];

    expect(await setProfileVisibility("instagram", "public")).toEqual({ success: true });
  });

  describe("the globe on the photo", () => {
    const found = async (): Promise<FetchImageResult> => ({ ok: true, bytes: await sharp({ create: { width: 300, height: 300, channels: 3, background: "#48a" } }).jpeg().toBuffer(), contentType: "image/jpeg" });
    const photoOf = (id: string) => state.dataset.members.find((m) => m.id === id)?.photoUrl;

    it("takes a photo that is already ours or on another host as it is, and fetches nothing", async () => {
      expect(await setProfileVisibility("photo", "public")).toEqual({ success: true });
      expect(fetchImage).not.toHaveBeenCalled();
      expect(photoOf(ADA)).toBe("https://photos.example.com/ada.png");
    });

    it("copies a Gravatar picture once, as the member's consent, and publishes the copy, never the Gravatar address", async () => {
      state.identity = { memberId: GRACE, isSudo: false };
      vi.mocked(fetchImage).mockImplementation(found);

      expect(await setProfileVisibility("photo", "public")).toEqual({ success: true });

      expect(fetchImage).toHaveBeenCalledTimes(1);
      expect(new URL(vi.mocked(fetchImage).mock.calls[0][0] as string).hostname).toBe(MEMBER_PHOTO.gravatarHost);
      expect(photoOf(GRACE)).toMatch(/^https:\/\/storage\.example\.test\/member-photos\/mbr_AAAAAAAAAAA2\/gravatar-[0-9a-f]{32}\.webp$/);
      expect((await state.repos.memberStatus.profileOverrideOf(GRACE))?.photo_path).toMatch(/^mbr_AAAAAAAAAAA2\/gravatar-/);
      expect((await state.repos.memberStatus.profileVisibilitiesOf(GRACE)).photo).toBe("public");
      expect(uploaded).toHaveLength(1);

      // The public read carries the copy, not a Gravatar address.
      await state.repos.writerProfiles.setHandle(GRACE, "grace-example", { reserveDays: 1, now: new Date(AT) });
      await state.repos.writerProfiles.update(GRACE, { isPublic: true });
      const lookup = await state.repos.writerProfiles.publicByHandle("grace-example");
      expect(lookup).toMatchObject({ kind: "page", profile: { photoUrl: photoOf(GRACE) } });
      expect(JSON.stringify(lookup)).not.toContain("gravatar.com");
    });

    it("does not fetch again once the copy exists", async () => {
      state.identity = { memberId: GRACE, isSudo: false };
      vi.mocked(fetchImage).mockImplementation(found);
      await setProfileVisibility("photo", "public");
      await setProfileVisibility("photo", "community");

      expect(await setProfileVisibility("photo", "public")).toEqual({ success: true });
      expect(fetchImage).toHaveBeenCalledTimes(1);
    });

    it("keeps the copy when they go back to the house or the lock, and the public page stops using it", async () => {
      state.identity = { memberId: GRACE, isSudo: false };
      vi.mocked(fetchImage).mockImplementation(found);
      await setProfileVisibility("photo", "public");
      const copy = photoOf(GRACE);
      await state.repos.writerProfiles.setHandle(GRACE, "grace-example", { reserveDays: 1, now: new Date(AT) });
      await state.repos.writerProfiles.update(GRACE, { isPublic: true });

      for (const level of ["community", "private"]) {
        expect(await setProfileVisibility("photo", level)).toEqual({ success: true });
        expect(photoOf(GRACE)).toBe(copy);
        expect(uploaded).toHaveLength(1);
        expect(await state.repos.writerProfiles.publicByHandle("grace-example")).toMatchObject({ kind: "page", profile: { photoUrl: null } });
      }
    });

    it("sends a member with no Gravatar to the upload, saves nothing and leaves the level alone", async () => {
      state.identity = { memberId: GRACE, isSudo: false };
      vi.mocked(fetchImage).mockResolvedValue({ ok: false, reason: "bad_status", detail: "404", status: 404 });

      expect(await setProfileVisibility("photo", "public")).toEqual({ error: expect.stringMatching(/couldn't find a Gravatar picture.*Upload one above/) });

      expect(uploaded).toEqual([]);
      expect((await state.repos.memberStatus.profileVisibilitiesOf(GRACE)).photo).toBe("community");
      expect(photoOf(GRACE)).toContain("gravatar.com");
    });

    it("says to try again or upload when the copy fails for another reason", async () => {
      state.identity = { memberId: GRACE, isSudo: false };
      vi.mocked(fetchImage).mockResolvedValue({ ok: false, reason: "timeout", detail: "slow" });

      expect(await setProfileVisibility("photo", "public")).toEqual({ error: expect.stringMatching(/Try again, or upload a photo/) });
      expect((await state.repos.memberStatus.profileVisibilitiesOf(GRACE)).photo).toBe("community");
    });

    it("asks for an upload when there is no photo at all", async () => {
      state.dataset.members.find((m) => m.id === GRACE)!.photoUrl = null;
      state.identity = { memberId: GRACE, isSudo: false };

      expect(await setProfileVisibility("photo", "public")).toEqual({ error: expect.stringMatching(/Upload one above/) });
      expect(fetchImage).not.toHaveBeenCalled();
    });

    it("does not copy a member's photo for staff acting as them (sudo)", async () => {
      state.identity = { memberId: GRACE, isSudo: true };

      expect(await setProfileVisibility("photo", "public")).toEqual({ error: expect.stringMatching(/Staff can look/) });
      expect(fetchImage).not.toHaveBeenCalled();
      expect(photoOf(GRACE)).toContain("gravatar.com");
    });

    it("the lock and the house never need a photo or a fetch", async () => {
      state.identity = { memberId: GRACE, isSudo: false };
      expect(await setProfileVisibility("photo", "private")).toEqual({ success: true });
      expect(await setProfileVisibility("photo", "community")).toEqual({ success: true });
      expect(fetchImage).not.toHaveBeenCalled();
    });
  });

  it("writes nothing when the level is already that one", async () => {
    expect(await setProfileVisibility("facebook", "community")).toEqual({ success: true });
    expect(state.dataset.memberProfileOverrides).toEqual([]);
    expect(revalidated).toEqual([]);
  });

  it("changes the member's levels, not the admin's, in sudo", async () => {
    state.identity = { memberId: GRACE, isSudo: true };
    state.user = { id: "00000000-0000-4000-a000-0000000000ad", email: "admin@example.test" };

    await setProfileVisibility("x", "private");

    expect((await state.repos.memberStatus.profileVisibilitiesOf(GRACE)).x).toBe("private");
    expect((await state.repos.memberStatus.profileVisibilitiesOf(ADA)).x).toBe("community");
    expect(state.dataset.memberProfileOverrides[0]).toMatchObject({ member_id: GRACE, updated_by: "00000000-0000-4000-a000-0000000000ad" });
  });

  it("answers with an error and no trace of the item when the database fails", async () => {
    vi.spyOn(state.repos.memberStatus, "saveProfileVisibility").mockRejectedValue(new Error("boom"));

    expect(await setProfileVisibility("bio", "private")).toEqual({ error: "Couldn't save that — please try again." });
  });

  it("revalidates the writer profile of a member who has one when a web item changes", async () => {
    await state.repos.writerProfiles.setHandle(ADA, "ada-example", { reserveDays: 1, now: new Date(AT) });

    await setProfileVisibility("bio", "public");

    expect(revalidated).toContain("/w/ada-example");
  });
});
