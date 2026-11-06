import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

let repos: ReturnType<typeof createInMemoryRepos>;
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/kajabi/client", () => ({ createKajabiClient: vi.fn() }));
vi.mock("@/lib/processing/trigger", () => ({ triggerReprocessing: vi.fn() }));
const afterCallbacks: Array<() => unknown> = [];
vi.mock("next/server", () => ({ after: (fn: () => unknown) => afterCallbacks.push(fn) }));

import { requestEmailChange, getIdentitySettings } from "@/app/(member)/settings/identityActions";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { APP_URL, SUPPORT_EMAIL } from "@/lib/config";
import { PENDING_EMAIL_KEY } from "@/lib/member-email";

const ME = "mbr_AAAAAAAAAAA1";
const USER = "00000000-0000-4000-8000-000000000001";
const identity = (isSudo = false) => ({ memberId: ME, memberName: "Ada Example", memberEmail: "Old@Example.com", isSudo });

let updateUser: ReturnType<typeof vi.fn>;

beforeEach(() => {
  afterCallbacks.length = 0;
  repos = createInMemoryRepos(
    new InMemoryDataset({
      members: [
        { id: ME, name: "Ada Example", email: "old@example.com", userId: USER },
        { id: "mbr_AAAAAAAAAAA2", name: "Grace Example", email: "taken@example.com" },
      ],
      authUsers: [{ id: USER, email: "old@example.com", confirmed: true, createdAt: "2026-01-01T00:00:00Z", bannedUntil: null, lastSignInAt: null, appMetadata: {} }],
    })
  );
  updateUser = vi.fn().mockResolvedValue({ error: null });
  vi.mocked(createClient).mockResolvedValue({ auth: { updateUser } } as never);
  vi.mocked(getCurrentUser).mockResolvedValue({ id: USER, email: "old@example.com" } as never);
  vi.mocked(getEffectiveIdentity).mockResolvedValue(identity() as never);
});

describe("requestEmailChange", () => {
  it("remembers the request and has Supabase mail a confirmation link to the new address", async () => {
    expect(await requestEmailChange("  New@Example.com ")).toEqual({ success: true, sentTo: "new@example.com" });

    expect(updateUser).toHaveBeenCalledWith({ email: "new@example.com" }, { emailRedirectTo: `${APP_URL}/auth/callback?next=/settings/identity` });
    expect((await repos.authUsers.byId(USER))!.appMetadata[PENDING_EMAIL_KEY]).toBe("new@example.com");
    // Nothing moves until the link is opened.
    expect((await repos.members.byId(ME))!.email).toBe("old@example.com");
  });

  it("refuses an invalid address, the current one, and one another member has, without saying whose", async () => {
    expect(await requestEmailChange("nope")).toEqual({ error: "Enter a valid email address" });
    expect(await requestEmailChange("OLD@example.com")).toEqual({ error: "That's already your primary email" });
    const taken = await requestEmailChange("taken@example.com");
    expect(taken).toEqual({ error: `That email is already in use. Email ${SUPPORT_EMAIL} if it's yours.` });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("is refused in sudo, where the signed-in account is the admin's", async () => {
    vi.mocked(getEffectiveIdentity).mockResolvedValue(identity(true) as never);

    expect(await requestEmailChange("new@example.com")).toEqual({ error: "Switch back to your own account to change the email." });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("needs a signed-in member", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect(await requestEmailChange("new@example.com")).toEqual({ error: "Not authenticated" });
  });

  it("passes on Supabase's refusal, with the in-use wording for an address that has an account", async () => {
    updateUser.mockResolvedValueOnce({ error: { code: "email_exists", message: "exists" } });
    expect(await requestEmailChange("new@example.com")).toEqual({ error: `That email is already in use. Email ${SUPPORT_EMAIL} if it's yours.` });

    updateUser.mockResolvedValueOnce({ error: { code: "over_email_send_rate_limit", message: "Too many emails" } });
    expect(await requestEmailChange("new@example.com")).toEqual({ error: "Too many emails" });
  });
});

describe("getIdentitySettings", () => {
  it("shows the new primary email and reprocesses aliases once a requested change is confirmed", async () => {
    vi.mocked(createClient).mockResolvedValue({} as never);
    await repos.authUsers.mergeAppMetadata(USER, { [PENDING_EMAIL_KEY]: "new@example.com" });
    await repos.authUsers.setEmail(USER, "new@example.com");

    const settings = await getIdentitySettings();

    expect(settings).toMatchObject({ primaryEmail: "new@example.com" });
    expect(afterCallbacks).toHaveLength(1);
  });

  it("leaves a pending change alone while the member is acted as in sudo", async () => {
    vi.mocked(getEffectiveIdentity).mockResolvedValue(identity(true) as never);
    await repos.authUsers.mergeAppMetadata(USER, { [PENDING_EMAIL_KEY]: "new@example.com" });
    await repos.authUsers.setEmail(USER, "new@example.com");

    await getIdentitySettings();

    expect(afterCallbacks).toHaveLength(0);
    expect((await repos.members.byId(ME))!.email).toBe("old@example.com");
  });
});
