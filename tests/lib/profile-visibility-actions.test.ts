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

import { setProfileVisibility } from "@/app/(member)/settings/profileVisibilityActions";
import { WRITER_PAGES_NOT_AVAILABLE } from "@/lib/writer-pages-access";

const flagRow = (enabled_globally: boolean) => ({ feature_key: "writer_pages", enabled_globally, created_at: AT, updated_at: AT });

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
    expect(await setProfileVisibility("bio", "public")).toEqual({ error: WRITER_PAGES_NOT_AVAILABLE });
    expect(state.dataset.memberProfileOverrides).toEqual([]);

    await state.repos.memberStatus.saveProfileVisibility(ADA, "bio", "public", null);
    expect(await setProfileVisibility("bio", "community")).toEqual({ success: true });
    expect((await state.repos.memberStatus.profileVisibilitiesOf(ADA)).bio).toBe("community");
  });

  it("allows the globe when the flag is on for the member through their own preview", async () => {
    state.dataset.featureFlags = [flagRow(false)];
    state.dataset.userFeaturePreviews = [{ user_id: "user-ada", feature_key: "writer_pages", enabled_at: AT }];

    expect(await setProfileVisibility("instagram", "public")).toEqual({ success: true });
  });

  it("refuses the globe on a photo that can never be published, such as a Gravatar picture", async () => {
    state.identity = { memberId: GRACE, isSudo: false };

    expect(await setProfileVisibility("photo", "public")).toEqual({ error: expect.stringContaining("Gravatar") });
    expect((await state.repos.memberStatus.profileVisibilitiesOf(GRACE)).photo).toBe("community");
    expect(await setProfileVisibility("photo", "private")).toEqual({ success: true });
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

  it("revalidates the writer page of a member who has one when a web item changes", async () => {
    await state.repos.writerProfiles.setHandle(ADA, "ada-example", { reserveDays: 1, now: new Date(AT) });

    await setProfileVisibility("bio", "public");

    expect(revalidated).toContain("/w/ada-example");
  });
});
