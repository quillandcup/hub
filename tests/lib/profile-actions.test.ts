import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const afterCallbacks: Array<() => unknown> = [];
vi.mock("next/server", () => ({
  after: (fn: () => unknown) => {
    afterCallbacks.push(fn);
  },
}));

const triggerReprocessingMock = vi.fn();
vi.mock("@/lib/processing/trigger", () => ({
  triggerReprocessing: (...args: unknown[]) => triggerReprocessingMock(...args),
}));

// Never hit the real Kajabi API.
const updateContactMock = vi.fn();
const fetchContactMock = vi.fn();
vi.mock("@/lib/kajabi/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/kajabi/client")>();
  return {
    ...actual,
    createKajabiClient: () => ({ updateContact: updateContactMock, fetchContact: fetchContactMock }),
  };
});

import {
  updateAskMeAbout,
  updateInstagramHandle,
  updateProfileDetails,
  getProfileSettings,
} from "@/app/(member)/settings/profileActions";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";

const IDENTITY = { memberId: "member-1", memberName: "Test Member", memberEmail: "member@example.com", isSudo: false };

type MemberRow = {
  email: string;
  kajabi_id: string | null;
  bio: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  twitter_url: string | null;
};

type OverrideRow = { bio: string | null; facebook_url: string | null; twitter_url: string | null };

/** The caller's own (RLS-scoped) session: member_profile_overrides and member_ask_me_about go through it. */
function makeUserClient({
  override = null as OverrideRow | null,
  upsertError = null as { message: string } | null,
  topics = null as string[] | null,
  askUpsertError = null as { message: string } | null,
} = {}) {
  const upsert = vi.fn(async () => ({ error: upsertError }));
  const overrideEq = vi.fn(() => ({ maybeSingle: async () => ({ data: override, error: null }) }));
  const askUpsert = vi.fn(async () => ({ error: askUpsertError }));
  const askEq = vi.fn(() => ({ maybeSingle: async () => ({ data: topics ? { topics } : null, error: null }) }));
  const from = vi.fn((table: string) => {
    if (table === "member_profile_overrides") return { select: () => ({ eq: overrideEq }), upsert };
    if (table === "member_ask_me_about") return { select: () => ({ eq: askEq }), upsert: askUpsert };
    throw new Error(`unexpected user-session table ${table}`);
  });
  return { from, upsert, overrideEq, askUpsert, askEq };
}

/** Service role: members row, alias lookup and Bronze, each scoped to the member by the action. */
function makeServiceClient({
  member,
  contactCustom1 = null as string | null,
  customerAttributes = {} as Record<string, unknown>,
  bronzeUpsertError = null as { message: string } | null,
}: {
  member: MemberRow;
  contactCustom1?: string | null;
  customerAttributes?: Record<string, unknown>;
  bronzeUpsertError?: { message: string } | null;
}) {
  const upsert = vi.fn(async () => ({ error: bronzeUpsertError }));
  const membersUpdate = vi.fn();
  const membersUpsert = vi.fn();
  const membersEq = vi.fn(() => ({ single: async () => ({ data: member, error: null }) }));
  const from = vi.fn((table: string) => {
    if (table === "members") return { select: () => ({ eq: membersEq }), update: membersUpdate, upsert: membersUpsert };
    if (table === "member_email_aliases") {
      return { select: () => ({ eq: () => ({ eq: async () => ({ data: [], error: null }) }) }) };
    }
    throw new Error(`unexpected service table ${table}`);
  });
  const schema = vi.fn(() => ({
    from: (table: string) => {
      if (table === "kajabi_contacts") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { data: { attributes: { custom_1: contactCustom1 } } }, error: null }),
            }),
          }),
          upsert,
        };
      }
      if (table === "kajabi_customers") {
        return {
          select: () => ({
            in: async () => ({
              data: [{ updated_at_kajabi: "2026-01-01T00:00:00Z", data: { attributes: customerAttributes } }],
              error: null,
            }),
          }),
        };
      }
      throw new Error(`unexpected bronze table ${table}`);
    },
  }));
  return { from, schema, upsert, membersEq, membersUpdate, membersUpsert };
}

const MEMBER: MemberRow = {
  email: "member@example.com",
  kajabi_id: "kj-1",
  bio: "Writes cozy mysteries.",
  instagram_url: "https://instagram.com/old_handle",
  facebook_url: null,
  twitter_url: null,
};
const KAJABI_ATTRS = { public_bio: "Writes cozy mysteries." };

const FRESH_CONTACT = {
  id: "kj-1",
  type: "contacts",
  attributes: {
    name: "Test Member",
    email: "Member@Example.com",
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2026-09-26T00:00:00Z",
    custom_1: "new_handle",
  },
  tags: ["Ideal Hedgie"],
};

let service: ReturnType<typeof makeServiceClient>;
let userClient: ReturnType<typeof makeUserClient>;

function setup(
  opts: {
    member?: MemberRow;
    override?: OverrideRow | null;
    overrideUpsertError?: { message: string };
    topics?: string[] | null;
    askUpsertError?: { message: string };
    service?: Omit<Parameters<typeof makeServiceClient>[0], "member">;
  } = {}
) {
  userClient = makeUserClient({
    override: opts.override ?? null,
    upsertError: opts.overrideUpsertError ?? null,
    topics: opts.topics ?? null,
    askUpsertError: opts.askUpsertError ?? null,
  });
  service = makeServiceClient({
    member: opts.member ?? MEMBER,
    contactCustom1: "old_handle",
    customerAttributes: KAJABI_ATTRS,
    ...opts.service,
  });
  vi.mocked(createClient).mockResolvedValue(userClient as any);
  vi.mocked(createServiceRoleClient).mockReturnValue(service as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  afterCallbacks.length = 0;
  vi.mocked(getCurrentUser).mockResolvedValue({ id: "auth-1", email: "member@example.com" } as any);
  vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);
  triggerReprocessingMock.mockResolvedValue({ processed: [{ table: "members", success: true }] });
});

describe("updateInstagramHandle", () => {
  it("writes the handle to Kajabi, refreshes that contact into Bronze, then reprocesses members", async () => {
    setup();
    updateContactMock.mockResolvedValue({});
    fetchContactMock.mockResolvedValue(FRESH_CONTACT);

    const result = await updateInstagramHandle("https://www.instagram.com/new_handle/");

    expect(result).toEqual({ success: true, syncPending: true });
    expect(updateContactMock).toHaveBeenCalledWith("kj-1", { custom_1: "new_handle" });
    expect(fetchContactMock).toHaveBeenCalledWith("kj-1");
    expect(service.upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          kajabi_contact_id: "kj-1",
          email: "member@example.com",
          data: FRESH_CONTACT,
          imported_at: expect.any(String),
        }),
      ],
      { onConflict: "kajabi_contact_id" }
    );

    // Silver reprocess runs after the response, through the normal pipeline.
    expect(triggerReprocessingMock).not.toHaveBeenCalled();
    await Promise.all(afterCallbacks.map((fn) => fn()));
    expect(triggerReprocessingMock).toHaveBeenCalledWith("kajabi_contacts", "bronze");
  });

  it("never writes Silver members directly", async () => {
    setup();
    updateContactMock.mockResolvedValue({});
    fetchContactMock.mockResolvedValue(FRESH_CONTACT);

    await updateInstagramHandle("@new_handle");
    expect(service.membersUpdate).not.toHaveBeenCalled();
    expect(service.membersUpsert).not.toHaveBeenCalled();
    expect(userClient.upsert).not.toHaveBeenCalled();
  });

  it("sends null to clear the handle", async () => {
    setup();
    updateContactMock.mockResolvedValue({});
    fetchContactMock.mockResolvedValue({ ...FRESH_CONTACT, attributes: { ...FRESH_CONTACT.attributes, custom_1: null } });

    const result = await updateInstagramHandle("   ");
    expect(result).toEqual({ success: true, syncPending: true });
    expect(updateContactMock).toHaveBeenCalledWith("kj-1", { custom_1: null });
  });

  it("does no local write or reprocess when Kajabi rejects the update", async () => {
    setup();
    updateContactMock.mockRejectedValue(new Error("Kajabi API error (422): invalid"));

    const result = await updateInstagramHandle("@new_handle");

    expect(result).toEqual({ error: expect.stringContaining("Kajabi API error (422)") });
    expect(fetchContactMock).not.toHaveBeenCalled();
    expect(service.upsert).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(0);
    expect(triggerReprocessingMock).not.toHaveBeenCalled();
  });

  it("rejects invalid input before calling Kajabi", async () => {
    setup();
    const result = await updateInstagramHandle("javascript:alert(1)");
    expect(result).toHaveProperty("error");
    expect(updateContactMock).not.toHaveBeenCalled();
  });

  it("is a no-op when the handle is unchanged", async () => {
    setup();
    const result = await updateInstagramHandle("@old_handle");
    expect(result).toEqual({ success: true, syncPending: false });
    expect(updateContactMock).not.toHaveBeenCalled();
    expect(service.upsert).not.toHaveBeenCalled();
  });

  it("still writes the custom field when the Kajabi directory profile has its own Instagram", async () => {
    // The custom field wins in member processing, so the edit always takes effect.
    setup({ service: { customerAttributes: { socials: { instagram: "https://instagram.com/profile_handle" } } } });
    updateContactMock.mockResolvedValue({});
    fetchContactMock.mockResolvedValue(FRESH_CONTACT);

    const result = await updateInstagramHandle("@new_handle");
    expect(result).toEqual({ success: true, syncPending: true });
    expect(updateContactMock).toHaveBeenCalledWith("kj-1", { custom_1: "new_handle" });
  });

  it("refuses when the member has no Kajabi contact", async () => {
    setup({ member: { ...MEMBER, kajabi_id: null } });
    const result = await updateInstagramHandle("@new_handle");
    expect(result).toEqual({ error: expect.stringContaining("isn't linked to a Kajabi account") });
    expect(updateContactMock).not.toHaveBeenCalled();
  });

  it("reports success with a warning when Kajabi saved but the Bronze refresh failed", async () => {
    setup({ service: { bronzeUpsertError: { message: "db down" } } });
    updateContactMock.mockResolvedValue({});
    fetchContactMock.mockResolvedValue(FRESH_CONTACT);

    const result = await updateInstagramHandle("@new_handle");
    expect(result).toEqual({ success: true, syncPending: true, warning: expect.stringContaining("until tomorrow") });
    expect(afterCallbacks).toHaveLength(0);
  });

  it("edits the sudo'd member during admin sudo", async () => {
    vi.mocked(getEffectiveIdentity).mockResolvedValue({ ...IDENTITY, memberId: "member-2", isSudo: true });
    setup({ member: { ...MEMBER, kajabi_id: "kj-2" } });
    updateContactMock.mockResolvedValue({});
    fetchContactMock.mockResolvedValue({ ...FRESH_CONTACT, id: "kj-2" });

    await updateInstagramHandle("@new_handle");
    expect(service.membersEq).toHaveBeenCalledWith("id", "member-2");
    expect(updateContactMock).toHaveBeenCalledWith("kj-2", { custom_1: "new_handle" });
  });

  it("returns an error when not authenticated", async () => {
    setup();
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect(await updateInstagramHandle("@x")).toEqual({ error: "Not authenticated" });
  });
});

describe("updateProfileDetails", () => {
  it("upserts the effective member's own override row through the RLS-scoped session, then reprocesses members", async () => {
    setup();
    const result = await updateProfileDetails({
      bio: "  New bio  ",
      facebook: "https://www.facebook.com/hedgie.writes",
      x: "@hedgie",
    });

    expect(result).toEqual({ success: true, syncPending: true });
    expect(userClient.upsert).toHaveBeenCalledWith(
      {
        member_id: "member-1",
        bio: "New bio",
        facebook_url: "https://facebook.com/hedgie.writes",
        twitter_url: "https://x.com/hedgie",
        updated_by: "auth-1",
      },
      { onConflict: "member_id" }
    );
    expect(service.membersUpdate).not.toHaveBeenCalled();
    expect(updateContactMock).not.toHaveBeenCalled();

    await Promise.all(afterCallbacks.map((fn) => fn()));
    expect(triggerReprocessingMock).toHaveBeenCalledWith("member_profile_overrides", "local");
  });

  it("clears a previously set field to '' (no Kajabi fallback) and stores a value equal to Kajabi's as an explicit set", async () => {
    setup({ override: { bio: "Old override", facebook_url: null, twitter_url: "https://x.com/old" } });
    await updateProfileDetails({ bio: "Writes cozy mysteries.", facebook: "", x: "" });

    expect(userClient.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        bio: "Writes cozy mysteries.", // equals Kajabi's, but the member chose it
        facebook_url: null, // never set, left blank -> still never set
        twitter_url: "", // was set, now blank -> cleared
      }),
      { onConflict: "member_id" }
    );
  });

  it("leaves never-set fields NULL (following Kajabi) when the member saves them unchanged", async () => {
    setup(); // no override row; the form shows Kajabi's bio
    const result = await updateProfileDetails({ bio: "Writes cozy mysteries.", facebook: "", x: "" });
    expect(result).toEqual({ success: true, syncPending: false });
    expect(userClient.upsert).not.toHaveBeenCalled();
  });

  it("clears a Kajabi-sourced field the member blanks, so it stays hidden", async () => {
    setup();
    await updateProfileDetails({ bio: "", facebook: "", x: "" });
    expect(userClient.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ bio: "", facebook_url: null, twitter_url: null }),
      { onConflict: "member_id" }
    );
  });

  it("keeps a cleared field cleared when saved blank again", async () => {
    setup({ override: { bio: "", facebook_url: null, twitter_url: null } });
    const result = await updateProfileDetails({ bio: "", facebook: "", x: "" });
    expect(result).toEqual({ success: true, syncPending: false });
    expect(userClient.upsert).not.toHaveBeenCalled();
  });

  it("is a no-op when nothing changed", async () => {
    setup({ override: { bio: "Mine", facebook_url: null, twitter_url: null } });
    const result = await updateProfileDetails({ bio: "Mine", facebook: "", x: "" });
    expect(result).toEqual({ success: true, syncPending: false });
    expect(userClient.upsert).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(0);
  });

  it("writes the sudo'd member's row during admin sudo, recording the admin as updated_by", async () => {
    vi.mocked(getEffectiveIdentity).mockResolvedValue({ ...IDENTITY, memberId: "member-2", isSudo: true });
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "admin-auth", email: "admin@example.com" } as any);
    setup();

    await updateProfileDetails({ bio: "Sudo bio", facebook: "", x: "" });
    expect(userClient.overrideEq).toHaveBeenCalledWith("member_id", "member-2");
    expect(userClient.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ member_id: "member-2", bio: "Sudo bio", updated_by: "admin-auth" }),
      { onConflict: "member_id" }
    );
  });

  it("works for members without a Kajabi contact (overrides are Hub-owned)", async () => {
    setup({ member: { ...MEMBER, kajabi_id: null } });
    const result = await updateProfileDetails({ bio: "Staff bio", facebook: "", x: "" });
    expect(result).toEqual({ success: true, syncPending: true });
    expect(service.schema).not.toHaveBeenCalled();
  });

  it.each([
    [{ bio: "a".repeat(1001), facebook: "", x: "" }, /1000 characters/],
    [{ bio: "", facebook: "https://evil.example.com/me", x: "" }, /^Facebook:/],
    [{ bio: "", facebook: "", x: "javascript:alert(1)" }, /^X:/],
  ])("rejects invalid input %# without writing", async (input, message) => {
    setup();
    const result = await updateProfileDetails(input);
    expect(result).toEqual({ error: expect.stringMatching(message) });
    expect(userClient.upsert).not.toHaveBeenCalled();
  });

  it("returns an error and schedules nothing when the write is rejected", async () => {
    setup({ overrideUpsertError: { message: "new row violates row-level security policy" } });
    const result = await updateProfileDetails({ bio: "x", facebook: "", x: "" });
    expect(result).toEqual({ error: expect.stringContaining("Couldn't save") });
    expect(afterCallbacks).toHaveLength(0);
  });
});

describe("updateAskMeAbout", () => {
  it("saves normalized topics for the effective member, with no reprocessing", async () => {
    setup({ topics: ["plot"] });
    const result = await updateAskMeAbout([" cozy  mysteries ", "Plot", "plot", ""]);

    expect(result).toEqual({ success: true, syncPending: false });
    expect(userClient.askUpsert).toHaveBeenCalledWith(
      { member_id: "member-1", topics: ["cozy mysteries", "Plot"], updated_by: "auth-1" },
      { onConflict: "member_id" }
    );
    expect(afterCallbacks).toHaveLength(0);
  });

  it("skips the write when nothing changed", async () => {
    setup({ topics: ["cozy mysteries"] });
    expect(await updateAskMeAbout(["cozy mysteries"])).toEqual({ success: true, syncPending: false });
    expect(userClient.askUpsert).not.toHaveBeenCalled();
  });

  it("rejects invalid input without writing", async () => {
    setup();
    expect(await updateAskMeAbout(["x".repeat(41)])).toHaveProperty("error");
    expect(await updateAskMeAbout("nope" as unknown as string[])).toEqual({ error: "Invalid topics" });
    expect(userClient.askUpsert).not.toHaveBeenCalled();
  });

  it("reports a failed save", async () => {
    setup({ askUpsertError: { message: "boom" } });
    expect(await updateAskMeAbout(["pacing"])).toEqual({ error: "Couldn't save your topics — please try again." });
  });
});

describe("getProfileSettings", () => {
  it("flags a pending sync when Bronze has a handle Silver doesn't show yet", async () => {
    setup({ service: { contactCustom1: "new_handle" }, topics: ["worldbuilding"] });
    const result = await getProfileSettings();
    expect(result).toEqual({
      memberId: "member-1",
      kajabiLinked: true,
      instagramHandle: "new_handle",
      instagramFallbackUrl: null,
      details: { bio: "Writes cozy mysteries.", facebookUrl: null, twitterUrl: null },
      askMeAbout: ["worldbuilding"],
      syncPending: true,
    });
  });

  it("is not pending once Silver matches Bronze + overrides", async () => {
    setup();
    expect(await getProfileSettings()).toMatchObject({ instagramHandle: "old_handle", syncPending: false });
  });

  it("shows the override as the current value (never-set fields follow Kajabi) and is pending until reprocessed", async () => {
    setup({
      override: { bio: "Hub bio", facebook_url: null, twitter_url: "https://x.com/mine" },
      service: { customerAttributes: { public_bio: "Writes cozy mysteries.", socials: { facebook: "kajabi.fb" } } },
    });
    expect(await getProfileSettings()).toMatchObject({
      details: { bio: "Hub bio", facebookUrl: "https://facebook.com/kajabi.fb", twitterUrl: "https://x.com/mine" },
      syncPending: true,
    });
  });

  it("shows a cleared field as empty even though Kajabi has a value", async () => {
    setup({
      member: { ...MEMBER, bio: null },
      override: { bio: "", facebook_url: null, twitter_url: null },
    });
    expect(await getProfileSettings()).toMatchObject({
      details: { bio: null, facebookUrl: null, twitterUrl: null },
      syncPending: false,
    });
  });

  it("uses the custom field over socials.instagram and reports socials.instagram as the blank fallback", async () => {
    setup({ service: { customerAttributes: { ...KAJABI_ATTRS, socials: { instagram: "profile_handle" } } } });
    expect(await getProfileSettings()).toMatchObject({
      instagramHandle: "old_handle",
      instagramFallbackUrl: "https://instagram.com/profile_handle",
      syncPending: false,
    });
  });

  it("reports an unlinked member without touching Bronze", async () => {
    setup({ member: { ...MEMBER, kajabi_id: null, bio: null, instagram_url: null } });
    expect(await getProfileSettings()).toMatchObject({
      kajabiLinked: false,
      instagramHandle: null,
      instagramFallbackUrl: null,
      syncPending: false,
    });
    expect(service.schema).not.toHaveBeenCalled();
  });
});
