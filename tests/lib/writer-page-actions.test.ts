import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";
import { WRITER_PROFILES } from "@/lib/config";
import { useFakeClock } from "@/tests/helpers/fake-clock";

const ADA = "mbr_AAAAAAAAAAA1";
const GRACE = "mbr_AAAAAAAAAAA2";

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

import { claimWriterHandle, getWriterPageSettings, loadHandleStatus, saveWriterPageDetails, setWriterPageSwitch } from "@/app/(member)/settings/writerPageActions";

import { WRITER_PAGES_NOT_AVAILABLE, WRITER_PAGE_NAME_NEEDED } from "@/lib/writer-pages-access";

const DAY_MS = 24 * 60 * 60 * 1000;
const AT = "2027-01-01T00:00:00Z";
const flagRow = (enabled_globally: boolean) => ({ feature_key: "writer_pages", enabled_globally, created_at: AT, updated_at: AT });

beforeEach(() => {
  state.user = { id: "00000000-0000-4000-a000-0000000000a1", email: "ada@example.test" };
  state.identity = { memberId: ADA, isSudo: false };
  state.dataset = new InMemoryDataset({
    members: [
      { id: ADA, name: "Ada Legalname", displayName: "Ada Example", photoUrl: "https://photos.example.com/ada.png", userId: "user-ada" },
      { id: GRACE, name: "Grace Example", userId: "user-grace" },
    ],
    featureFlags: [flagRow(true)],
  });
  state.repos = createInMemoryRepos(state.dataset);
  revalidated.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("who may use it", () => {
  it("refuses everything to someone who is not signed in or has no member record, and writes nothing", async () => {
    for (const setup of [() => (state.user = null), () => ((state.user = { id: "u", email: "a@example.test" }), (state.identity = null))]) {
      setup();
      const results = await Promise.all([getWriterPageSettings(), loadHandleStatus("ada-example"), claimWriterHandle("ada-example"), setWriterPageSwitch(true), saveWriterPageDetails({ publicNameAliasId: null, bio: "" })]);
      for (const result of results) expect(result).toHaveProperty("error");
    }
    expect(state.dataset.writerProfiles).toEqual([]);
    expect(state.dataset.activities).toEqual([]);
  });
});

describe("the writer_pages flag", () => {
  it("is decided for the member: on globally, by a segment, or by their own preview", async () => {
    state.dataset.featureFlags = [flagRow(false)];
    expect(await getWriterPageSettings()).toMatchObject({ available: false });

    state.dataset.userFeaturePreviews = [{ user_id: "user-ada", feature_key: "writer_pages", enabled_at: AT }];
    expect(await getWriterPageSettings()).toMatchObject({ available: true });

    state.identity = { memberId: GRACE, isSudo: false };
    expect(await getWriterPageSettings()).toMatchObject({ available: false });

    state.dataset.segments = [{ id: "seg-1", name: "Early writers", created_at: AT, created_by: null }];
    state.dataset.featureFlagSegments = [{ feature_key: "writer_pages", segment_id: "seg-1", created_at: AT }];
    state.dataset.segmentMembers = [{ segment_id: "seg-1", member_id: GRACE, added_at: AT }];
    expect(await getWriterPageSettings()).toMatchObject({ available: true });
  });

  it("refuses to claim an address, switch the page on or save its details while it is off, and changes nothing", async () => {
    state.dataset.featureFlags = [flagRow(false)];
    const closed = { error: WRITER_PAGES_NOT_AVAILABLE };

    expect(await claimWriterHandle("ada-example")).toEqual(closed);
    expect(await setWriterPageSwitch(true)).toEqual(closed);
    expect(await saveWriterPageDetails({ publicNameAliasId: null, bio: "Hi" })).toEqual(closed);
    expect(state.dataset.writerProfiles).toEqual([]);
    expect(state.dataset.activities).toEqual([]);
  });

  it("never deletes or changes a page when it goes off, and a page that is on can still be switched off", async () => {
    await claimWriterHandle("ada-example");
    await saveWriterPageDetails({ publicNameAliasId: null, bio: "Kept as it was." });
    await setWriterPageSwitch(true);
    const before = structuredClone(await state.repos.writerProfiles.ofMember(ADA));

    state.dataset.featureFlags = [flagRow(false)];

    expect(await state.repos.writerProfiles.ofMember(ADA)).toEqual(before);
    expect(await setWriterPageSwitch(false)).toEqual({ success: true });
    expect(await state.repos.writerProfiles.ofMember(ADA)).toMatchObject({ isPublic: false, bio: "Kept as it was." });
  });

  it("asks about the member whose page it is when an admin acts as them (sudo)", async () => {
    state.dataset.featureFlags = [flagRow(false)];
    state.dataset.userFeaturePreviews = [{ user_id: "user-ada", feature_key: "writer_pages", enabled_at: AT }];
    state.identity = { memberId: GRACE, isSudo: true };

    expect(await claimWriterHandle("grace-example")).toEqual({ error: WRITER_PAGES_NOT_AVAILABLE });
  });
});

describe("getWriterPageSettings", () => {
  it("starts with no page: off, the display name to show, a suggested handle and a photo that can be shown", async () => {
    expect(await getWriterPageSettings()).toMatchObject({
      hasPage: false,
      handle: null,
      isPublic: false,
      publicBio: "",
      nameChosen: true,
      nameChoices: [{ aliasId: null, label: "Ada Example" }],
      photoAvailable: true,
      suggestedHandle: "ada-example",
      usingAccountName: false,
      pageUrl: null,
    });
  });

  it("offers a pen name only when it is theirs, active, added by them and marked for the page", async () => {
    state.dataset.nameAliases.push(
      { id: "nalias_AAAAAAAAAAA1", member_id: ADA, alias: "A. E. Pen", source: "member", active: true, isPublic: true },
      { id: "nalias_AAAAAAAAAAA2", member_id: ADA, alias: "Not Marked", source: "member", active: true, isPublic: false },
      { id: "nalias_AAAAAAAAAAA3", member_id: ADA, alias: "Zoom Typo", source: "zoom", active: true, isPublic: false },
      { id: "nalias_AAAAAAAAAAA4", member_id: ADA, alias: "Switched Off", source: "member", active: false, isPublic: true },
      { id: "nalias_AAAAAAAAAAA5", member_id: GRACE, alias: "Graces Pen", source: "member", active: true, isPublic: true }
    );

    const settings = await getWriterPageSettings();

    expect("error" in settings).toBe(false);
    expect((settings as { nameChoices: unknown }).nameChoices).toEqual([
      { aliasId: null, label: "Ada Example" },
      { aliasId: "nalias_AAAAAAAAAAA1", label: "A. E. Pen" },
    ]);
  });

  it("says when the page would show the name on the account, and when the only photo cannot be published", async () => {
    state.identity = { memberId: GRACE, isSudo: false };
    state.dataset.members.find((m) => m.id === GRACE)!.photoUrl = "https://secure.gravatar.com/avatar/0123456789abcdef";

    expect(await getWriterPageSettings()).toMatchObject({ usingAccountName: true, photoAvailable: false, nameChosen: false, nameChoices: [], suggestedHandle: "" });
  });

  it("shows the effective member's page, so sudo sees what the member sees", async () => {
    await state.repos.writerProfiles.setHandle(GRACE, "grace-example", { reserveDays: 1, now: new Date() });
    state.identity = { memberId: GRACE, isSudo: true };

    expect(await getWriterPageSettings()).toMatchObject({ hasPage: true, handle: "grace-example", pageUrl: expect.stringContaining("/w/grace-example") });
  });
});

describe("loadHandleStatus", () => {
  it("says why a handle cannot be used, without asking the database", async () => {
    expect(await loadHandleStatus("Ada Example")).toMatchObject({ status: "invalid" });
    expect(await loadHandleStatus("ab")).toMatchObject({ status: "invalid" });
    expect(await loadHandleStatus("admin")).toMatchObject({ status: "invalid", message: expect.stringContaining("kept for the community") });
  });

  it("says available, yours, taken and held", async () => {
    expect(await loadHandleStatus("ada-example")).toEqual({ status: "available" });
    await claimWriterHandle("ada-example");
    expect(await loadHandleStatus("ada-example")).toEqual({ status: "yours" });
    state.identity = { memberId: GRACE, isSudo: false };
    expect(await loadHandleStatus("ada-example")).toMatchObject({ status: "unavailable", message: expect.stringContaining("already uses") });

    state.identity = { memberId: ADA, isSudo: false };
    await claimWriterHandle("ada-new");
    state.identity = { memberId: GRACE, isSudo: false };
    expect(await loadHandleStatus("ada-example")).toMatchObject({ status: "unavailable", message: expect.stringContaining("held") });
  });
});

describe("claimWriterHandle", () => {
  const fake = useFakeClock(() => Date.parse("2027-03-01T12:00:00Z"));

  it("creates the page off, and records in the member's own history who chose the address, without the address in it", async () => {
    const result = await claimWriterHandle("  Ada-Example ");

    expect(result).toEqual({ success: true, handle: "ada-example", changed: false });
    expect(await state.repos.writerProfiles.ofMember(ADA)).toMatchObject({ handle: "ada-example", isPublic: false });
    expect(state.dataset.activities).toHaveLength(1);
    expect(state.dataset.activities[0]).toMatchObject({ member_id: ADA, activity_type: "writer_page_address_chosen", actor_kind: "member", source: "writer_page" });
    expect(JSON.stringify(state.dataset.activities)).not.toContain("ada-example");
    expect(revalidated).toContain("/w/ada-example");
  });

  it("refuses what is not a handle and the words kept for the community, and writes nothing", async () => {
    expect(await claimWriterHandle("ada example")).toHaveProperty("error");
    expect(await claimWriterHandle("admin")).toEqual({ error: expect.stringContaining("kept for the community") });
    expect(await claimWriterHandle("quill-and-cup")).toHaveProperty("error");
    expect(state.dataset.writerProfiles).toEqual([]);
    expect(state.dataset.activities).toEqual([]);
  });

  it("refuses a handle someone has", async () => {
    await claimWriterHandle("ada-example");
    state.identity = { memberId: GRACE, isSudo: false };

    expect(await claimWriterHandle("ada-example")).toEqual({ error: expect.stringContaining("already uses") });
    expect(await state.repos.writerProfiles.ofMember(GRACE)).toBeNull();
  });

  it("moves the page, says so, records the change, and holds the old handle for the configured days", async () => {
    await claimWriterHandle("ada-example");

    const result = await claimWriterHandle("ada-writes");

    expect(result).toEqual({ success: true, handle: "ada-writes", changed: true });
    expect(state.dataset.activities.map((a) => a.activity_type)).toEqual(["writer_page_address_chosen", "writer_page_address_changed"]);
    state.identity = { memberId: GRACE, isSudo: false };
    fake.clock.advance((WRITER_PROFILES.handleReservationDays - 1) * DAY_MS);
    expect(await claimWriterHandle("ada-example")).toEqual({ error: expect.stringContaining("held") });
    fake.clock.advance(2 * DAY_MS);
    expect(await claimWriterHandle("ada-example")).toMatchObject({ success: true });
  });

  it("records an admin's change as staff, for the member (sudo)", async () => {
    state.identity = { memberId: GRACE, isSudo: true };
    state.user = { id: "00000000-0000-4000-a000-0000000000ad", email: "admin@example.test" };

    await claimWriterHandle("grace-example");

    expect(state.dataset.activities[0]).toMatchObject({ member_id: GRACE, actor_kind: "staff", actor_user_id: "00000000-0000-4000-a000-0000000000ad" });
  });

  it("records nothing when the handle is already theirs", async () => {
    await claimWriterHandle("ada-example");
    await claimWriterHandle("ada-example");
    expect(state.dataset.activities).toHaveLength(1);
  });
});

describe("setWriterPageSwitch", () => {
  it("needs an address first", async () => {
    expect(await setWriterPageSwitch(true)).toEqual({ error: "Choose the address for your page first." });
  });

  it("turns the page on and off", async () => {
    await claimWriterHandle("ada-example");
    revalidated.length = 0;

    expect(await setWriterPageSwitch(true)).toEqual({ success: true });
    expect(await state.repos.writerProfiles.publicByHandle("ada-example")).toMatchObject({ kind: "page" });
    expect(revalidated).toContain("/w/ada-example");

    expect(await setWriterPageSwitch(false)).toEqual({ success: true });
    expect(await state.repos.writerProfiles.publicByHandle("ada-example")).toEqual({ kind: "none" });
  });
});

describe("switching the page on needs an address and a chosen name", () => {
  it("refuses a page whose only name would be the one on the account, and says what to do", async () => {
    state.identity = { memberId: GRACE, isSudo: false };
    await claimWriterHandle("grace-example");

    expect(await setWriterPageSwitch(true)).toEqual({ error: WRITER_PAGE_NAME_NEEDED });
    expect((await state.repos.writerProfiles.ofMember(GRACE))?.isPublic).toBe(false);
  });

  it("accepts a display name, or a pen name chosen for the page", async () => {
    await claimWriterHandle("ada-example");
    expect(await setWriterPageSwitch(true)).toEqual({ success: true });

    state.identity = { memberId: GRACE, isSudo: false };
    await claimWriterHandle("grace-example");
    state.dataset.nameAliases.push({ id: "nalias_AAAAAAAAAAA9", member_id: GRACE, alias: "G. E. Pen", source: "member", active: true, isPublic: true });
    await saveWriterPageDetails({ publicNameAliasId: "nalias_AAAAAAAAAAA9", bio: "" });
    expect(await getWriterPageSettings()).toMatchObject({ nameChosen: true, nameChoices: [{ aliasId: "nalias_AAAAAAAAAAA9", label: "G. E. Pen" }] });
    expect(await setWriterPageSwitch(true)).toEqual({ success: true });
  });

  it("suggests an address from the display name, never from the name on the account", async () => {
    expect(await getWriterPageSettings()).toMatchObject({ suggestedHandle: "ada-example" });
    state.identity = { memberId: GRACE, isSudo: false };
    expect(await getWriterPageSettings()).toMatchObject({ suggestedHandle: "" });
  });
});

describe("saveWriterPageDetails", () => {
  beforeEach(async () => {
    await claimWriterHandle("ada-example");
  });

  it("saves the bio as trimmed plain text, the photo switch and the name", async () => {
    state.dataset.nameAliases.push({ id: "nalias_AAAAAAAAAAA1", member_id: ADA, alias: "A. E. Pen", source: "member", active: true, isPublic: true });

    const result = await saveWriterPageDetails({ publicNameAliasId: "nalias_AAAAAAAAAAA1", bio: "  I write cozy mysteries.  " });

    expect(result).toEqual({ success: true });
    expect(await state.repos.writerProfiles.ofMember(ADA)).toMatchObject({ publicNameAliasId: "nalias_AAAAAAAAAAA1", bio: "I write cozy mysteries." });
    expect(revalidated).toContain("/w/ada-example");
  });

  it("refuses a bio over the limit and changes nothing", async () => {
    const result = await saveWriterPageDetails({ publicNameAliasId: null, bio: "x".repeat(WRITER_PROFILES.bioMaxLength + 1) });

    expect(result).toEqual({ error: expect.stringContaining(String(WRITER_PROFILES.bioMaxLength)) });
    expect((await state.repos.writerProfiles.ofMember(ADA))?.bio).toBeNull();
  });

  it("refuses a name that is not one of their public pen names, and keeps the one they had", async () => {
    state.dataset.nameAliases.push({ id: "nalias_AAAAAAAAAAA2", member_id: ADA, alias: "Zoom Typo", source: "zoom", active: true, isPublic: false });

    expect(await saveWriterPageDetails({ publicNameAliasId: "nalias_AAAAAAAAAAA2", bio: "" })).toEqual({ error: expect.stringContaining("pen names") });
    expect(await state.repos.writerProfiles.ofMember(ADA)).toMatchObject({ publicNameAliasId: null });
  });

  it("removes the separate public bio when saved empty, and never touches the member's own bio", async () => {
    state.dataset.members.find((m) => m.id === ADA)!.bio = "My member bio.";
    await saveWriterPageDetails({ publicNameAliasId: null, bio: "For the web." });
    expect(await state.repos.writerProfiles.ofMember(ADA)).toMatchObject({ bio: "For the web." });

    expect(await saveWriterPageDetails({ publicNameAliasId: null, bio: "   " })).toEqual({ success: true });

    expect(await state.repos.writerProfiles.ofMember(ADA)).toMatchObject({ bio: null });
    expect(state.dataset.members.find((m) => m.id === ADA)!.bio).toBe("My member bio.");
  });

  it("needs an address first", async () => {
    state.dataset.writerProfiles = [];
    expect(await saveWriterPageDetails({ publicNameAliasId: null, bio: "Hi" })).toEqual({ error: "Choose the address for your page first." });
  });
});
