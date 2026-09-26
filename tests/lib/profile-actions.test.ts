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

import { updateInstagramHandle, getProfileSettings } from "@/app/(member)/settings/profileActions";
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

function makeUserClient(member: MemberRow) {
  const from = vi.fn((table: string) => {
    if (table === "members") {
      return {
        select: () => ({ eq: () => ({ single: async () => ({ data: member, error: null }) }) }),
        update: vi.fn(),
        upsert: vi.fn(),
      };
    }
    if (table === "member_email_aliases") {
      return { select: () => ({ eq: () => ({ eq: async () => ({ data: [], error: null }) }) }) };
    }
    throw new Error(`unexpected table ${table}`);
  });
  return { from };
}

function makeServiceClient({
  contactCustom1 = null as string | null,
  nativeInstagram = null as string | null,
  upsertError = null as { message: string } | null,
} = {}) {
  const upsert = vi.fn(async () => ({ error: upsertError }));
  const schema = vi.fn(() => ({
    from: (table: string) => {
      if (table === "kajabi_contacts") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { data: { attributes: { custom_1: contactCustom1 } } },
                error: null,
              }),
            }),
          }),
          upsert,
        };
      }
      if (table === "kajabi_customers") {
        return {
          select: () => ({
            in: async () => ({
              data: [
                {
                  updated_at_kajabi: "2026-01-01T00:00:00Z",
                  data: { attributes: { socials: nativeInstagram ? { instagram: nativeInstagram } : null } },
                },
              ],
              error: null,
            }),
          }),
        };
      }
      throw new Error(`unexpected bronze table ${table}`);
    },
  }));
  return { schema, upsert };
}

const MEMBER: MemberRow = {
  email: "member@example.com",
  kajabi_id: "kj-1",
  bio: "Writes cozy mysteries.",
  instagram_url: "https://instagram.com/old_handle",
  facebook_url: null,
  twitter_url: null,
};

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

function setup(opts: { member?: MemberRow; service?: Parameters<typeof makeServiceClient>[0] } = {}) {
  userClient = makeUserClient(opts.member ?? MEMBER);
  service = makeServiceClient({ contactCustom1: "old_handle", ...opts.service });
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

    const membersCalls = userClient.from.mock.results
      .filter((_, i) => userClient.from.mock.calls[i][0] === "members")
      .map((r) => r.value);
    for (const table of membersCalls) {
      expect(table.update).not.toHaveBeenCalled();
      expect(table.upsert).not.toHaveBeenCalled();
    }
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

  it("refuses when the native Kajabi profile Instagram takes precedence", async () => {
    setup({ service: { nativeInstagram: "https://instagram.com/profile_handle" } });
    const result = await updateInstagramHandle("@new_handle");
    expect(result).toEqual({ error: expect.stringContaining("Kajabi profile") });
    expect(updateContactMock).not.toHaveBeenCalled();
  });

  it("refuses when the member has no Kajabi contact", async () => {
    setup({ member: { ...MEMBER, kajabi_id: null } });
    const result = await updateInstagramHandle("@new_handle");
    expect(result).toEqual({ error: expect.stringContaining("isn't linked to a Kajabi account") });
    expect(updateContactMock).not.toHaveBeenCalled();
  });

  it("reports success with a warning when Kajabi saved but the Bronze refresh failed", async () => {
    setup({ service: { upsertError: { message: "db down" } } });
    updateContactMock.mockResolvedValue({});
    fetchContactMock.mockResolvedValue(FRESH_CONTACT);

    const result = await updateInstagramHandle("@new_handle");
    expect(result).toEqual({ success: true, syncPending: true, warning: expect.stringContaining("next Kajabi sync") });
    expect(afterCallbacks).toHaveLength(0);
  });

  it("edits the sudo'd member during admin sudo", async () => {
    vi.mocked(getEffectiveIdentity).mockResolvedValue({ ...IDENTITY, memberId: "member-2", isSudo: true });
    setup({ member: { ...MEMBER, kajabi_id: "kj-2" } });
    updateContactMock.mockResolvedValue({});
    fetchContactMock.mockResolvedValue({ ...FRESH_CONTACT, id: "kj-2" });

    await updateInstagramHandle("@new_handle");
    expect(updateContactMock).toHaveBeenCalledWith("kj-2", { custom_1: "new_handle" });
  });

  it("returns an error when not authenticated", async () => {
    setup();
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect(await updateInstagramHandle("@x")).toEqual({ error: "Not authenticated" });
  });
});

describe("getProfileSettings", () => {
  it("flags a pending sync when Bronze has a handle Silver doesn't show yet", async () => {
    setup({ service: { contactCustom1: "new_handle" } });
    const result = await getProfileSettings();
    expect(result).toMatchObject({
      memberId: "member-1",
      kajabiLinked: true,
      bio: "Writes cozy mysteries.",
      instagramHandle: "new_handle",
      instagramManagedInKajabiProfile: false,
      syncPending: true,
    });
  });

  it("is not pending once Silver matches Bronze", async () => {
    setup();
    expect(await getProfileSettings()).toMatchObject({ instagramHandle: "old_handle", syncPending: false });
  });

  it("marks Instagram as managed in the Kajabi profile when socials.instagram is set", async () => {
    setup({ service: { nativeInstagram: "profile_handle" } });
    expect(await getProfileSettings()).toMatchObject({ instagramManagedInKajabiProfile: true, syncPending: false });
  });
});
