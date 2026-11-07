/**
 * Switching the primary email from /settings/identity: an address is added unconfirmed and mailed a link,
 * only a confirmed one can be made primary, and then the member, Kajabi and the sign-in account move together.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

let repos: ReturnType<typeof createInMemoryRepos>;
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({})) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const updateContact = vi.hoisted(() => vi.fn());
vi.mock("@/lib/kajabi/client", () => ({ createKajabiClient: () => ({ updateContact }) }));
vi.mock("@/lib/kajabi/contact-refresh", () => ({ refreshKajabiContactInBronze: vi.fn() }));
const afterCallbacks: Array<() => unknown> = [];
vi.mock("next/server", () => ({ after: (fn: () => unknown) => afterCallbacks.push(fn) }));
const triggerReprocessing = vi.hoisted(() => vi.fn());
vi.mock("@/lib/processing/trigger", () => ({ triggerReprocessing }));
const sendEmail = vi.hoisted(() => vi.fn());
vi.mock("@/lib/email", () => ({ sendEmail }));

import { addEmailAlias, makeEmailPrimary, resendEmailVerification } from "@/app/(member)/settings/identityActions";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { SUPPORT_EMAIL } from "@/lib/config";

const ME = "mbr_AAAAAAAAAAA1";
const OTHER = "mbr_AAAAAAAAAAA2";
const USER = "00000000-0000-4000-8000-000000000001";
const identity = (isSudo = false) => ({ memberId: ME, memberName: "Ada Example", memberEmail: "ada@example.com", isSudo });

const aliasOf = async (address: string) => (await repos.aliases.emailsOf(ME)).find((a) => a.alias_email === address)!;

beforeEach(() => {
  process.env.EMAIL_UNSUBSCRIBE_SECRET = "test-secret";
  afterCallbacks.length = 0;
  updateContact.mockReset().mockResolvedValue(undefined);
  sendEmail.mockReset().mockResolvedValue(undefined);
  triggerReprocessing.mockReset();
  repos = createInMemoryRepos(
    new InMemoryDataset({
      members: [
        { id: ME, name: "Ada Example", email: "ada@example.com", userId: USER, kajabiId: "kaj1" },
        { id: OTHER, name: "Grace Example", email: "grace@example.com" },
      ],
      authUsers: [{ id: USER, email: "ada@example.com", confirmed: true, createdAt: "2026-01-01T00:00:00Z", bannedUntil: null, lastSignInAt: null, appMetadata: {} }],
    })
  );
  vi.mocked(getCurrentUser).mockResolvedValue({ id: USER, email: "ada@example.com" } as never);
  vi.mocked(getEffectiveIdentity).mockResolvedValue(identity() as never);
});

describe("addEmailAlias", () => {
  it("adds the address unconfirmed and mails it a confirmation link", async () => {
    expect(await addEmailAlias("Ada.New@Example.com")).toEqual({ success: true, verificationSent: true });

    expect(await aliasOf("ada.new@example.com")).toMatchObject({ active: true, verifiedAt: null });
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "ada.new@example.com" }));
  });

  it("still adds it when the email can't be sent, and says so", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    sendEmail.mockRejectedValue(new Error("Resend is down"));

    expect(await addEmailAlias("ada.new@example.com")).toEqual({ success: true, verificationSent: false });
    expect(await aliasOf("ada.new@example.com")).toBeTruthy();
  });
});

describe("resendEmailVerification", () => {
  it("sends the link again, once a minute, and only to the member's own address", async () => {
    await addEmailAlias("ada.new@example.com");
    const { id } = await aliasOf("ada.new@example.com");

    expect(await resendEmailVerification(id)).toMatchObject({ error: expect.stringContaining("just sent") });
    expect(sendEmail).toHaveBeenCalledTimes(1);

    vi.mocked(getEffectiveIdentity).mockResolvedValue({ ...identity(), memberId: OTHER } as never);
    expect(await resendEmailVerification(id)).toEqual({ error: "That email isn't on your account." });
  });

  it("is refused in sudo", async () => {
    vi.mocked(getEffectiveIdentity).mockResolvedValue(identity(true) as never);
    expect(await resendEmailVerification("any")).toEqual({ error: "Switch back to your own account to do this." });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("makeEmailPrimary", () => {
  const confirmed = async (address = "ada.new@example.com") => {
    await repos.aliases.addEmail(ME, address, "manual");
    const { id } = await aliasOf(address);
    await repos.aliases.markEmailVerified(id, address);
    return id;
  };

  it("moves the member, Kajabi and the sign-in to a confirmed address, and keeps the old one as a confirmed alias", async () => {
    const id = await confirmed();

    expect(await makeEmailPrimary(id)).toEqual({ success: true });

    expect((await repos.members.byId(ME))!.email).toBe("ada.new@example.com");
    expect((await repos.authUsers.byId(USER))!.email).toBe("ada.new@example.com");
    expect(updateContact).toHaveBeenCalledWith("kaj1", { email: "ada.new@example.com" });
    const aliases = await repos.aliases.emailsOf(ME);
    expect(aliases.map((a) => a.alias_email)).toEqual(["ada@example.com"]);
    expect(aliases[0].verifiedAt).not.toBeNull();
    await Promise.all(afterCallbacks.map((fn) => fn()));
    expect(triggerReprocessing).toHaveBeenCalledWith("member_email_aliases", "local");

    // The old address hears about it too, as does the new one.
    const notices = sendEmail.mock.calls.map(([mail]) => mail).filter((mail) => mail.tags?.kind === "email_changed");
    expect(notices.map((mail) => mail.to).sort()).toEqual(["ada.new@example.com", "ada@example.com"]);
    expect(notices[0].text).toContain("from a signed-in session");
  });

  it("sends no notice when the change is refused", async () => {
    await repos.aliases.addEmail(ME, "unconfirmed@example.com", "manual");
    await makeEmailPrimary((await aliasOf("unconfirmed@example.com")).id);
    await Promise.all(afterCallbacks.map((fn) => fn()));

    expect(sendEmail.mock.calls.filter(([mail]) => mail.tags?.kind === "email_changed")).toEqual([]);
  });

  it("refuses an address that isn't confirmed, turned off, someone else's, or unknown", async () => {
    await repos.aliases.addEmail(ME, "unconfirmed@example.com", "manual");
    expect(await makeEmailPrimary((await aliasOf("unconfirmed@example.com")).id)).toEqual({ error: "Confirm that email first: open the link we sent to it." });

    const off = await confirmed("off@example.com");
    await repos.aliases.setEmailActive(ME, off, false);
    expect(await makeEmailPrimary(off)).toMatchObject({ error: expect.stringContaining("turned off") });

    const mine = await confirmed();
    vi.mocked(getEffectiveIdentity).mockResolvedValue({ ...identity(), memberId: OTHER } as never);
    expect(await makeEmailPrimary(mine)).toEqual({ error: "That email isn't on your account." });
    expect(await makeEmailPrimary("eal_missing")).toEqual({ error: "That email isn't on your account." });

    expect((await repos.members.byId(ME))!.email).toBe("ada@example.com");
    expect(updateContact).not.toHaveBeenCalled();
  });

  it("is refused in sudo, where the signed-in account is the admin's", async () => {
    const id = await confirmed();
    vi.mocked(getEffectiveIdentity).mockResolvedValue(identity(true) as never);

    expect(await makeEmailPrimary(id)).toEqual({ error: "Switch back to your own account to do this." });
    expect((await repos.authUsers.byId(USER))!.email).toBe("ada@example.com");
  });

  it("never tells a member whose Kajabi contact holds the address", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const id = await confirmed();
    await repos.members.setExternalIds(OTHER, { kajabiId: "kaj-grace" });
    await repos.billing.upsertKajabiContacts([{ kajabi_contact_id: "kaj-grace", email: "ada.new@example.com", name: "Grace Example", data: {}, imported_at: "2026-01-01T00:00:00Z" }]);
    updateContact.mockRejectedValue(new Error('Kajabi API error (422): {"errors":[{"detail":"Email is already taken"}]}'));

    const result = await makeEmailPrimary(id);

    expect(result).toEqual({ error: `That email can't be used right now. Email ${SUPPORT_EMAIL} for help.` });
    expect(JSON.stringify(result)).not.toMatch(/Grace|kaj-grace/);
    expect((await repos.authUsers.byId(USER))!.email).toBe("ada@example.com");
  });

  it("explains without naming anyone when the address has become someone else's, and passes on a Kajabi failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const id = await confirmed();
    await repos.members.setEmail(OTHER, "ada.new@example.com");
    expect(await makeEmailPrimary(id)).toEqual({ error: `That email can't be used right now. Email ${SUPPORT_EMAIL} for help.` });

    await repos.members.setEmail(OTHER, "grace@example.com");
    updateContact.mockRejectedValue(new Error("Kajabi is down"));
    expect(await makeEmailPrimary(id)).toEqual({ error: "Kajabi is down" });
    expect((await repos.authUsers.byId(USER))!.email).toBe("ada@example.com");
  });
});
