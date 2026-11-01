import { beforeEach, describe, expect, it, vi } from "vitest";

let admin: { ok: true; user: { id: string } } | { ok: false; error: string } = { ok: true, user: { id: "admin-user" } };
vi.mock("@/lib/admin-auth", () => ({ requireAdminAction: async () => admin }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const withAction = vi.fn(async (_name: string, run: () => Promise<unknown>, _classify?: (r: unknown) => { ok: boolean }) => run());
vi.mock("@/lib/analytics/server", () => ({ withAction: (...a: Parameters<typeof withAction>) => withAction(...a) }));

const member = { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", email: "ada@example.test", userId: "user-ada" as string | null };
let found: typeof member | null = member;
const isAdmin = vi.fn(async () => false);
vi.mock("@/lib/data/repos", () => ({ createRepos: () => ({ members: { byId: async () => found }, profiles: { isAdmin } }) }));

const preview = vi.fn();
const removeOnRequest = vi.fn();
vi.mock("@/lib/member-removal", () => ({ previewMemberRemoval: (...a: unknown[]) => preview(...a), removeMemberOnRequest: (...a: unknown[]) => removeOnRequest(...a) }));

import { previewRemoval, removeMember } from "@/app/(admin)/admin/members/[id]/removal-actions";

beforeEach(() => {
  vi.clearAllMocks();
  admin = { ok: true, user: { id: "admin-user" } };
  found = { ...member };
  isAdmin.mockResolvedValue(false);
  removeOnRequest.mockResolvedValue({ ok: true, leftovers: [] });
  preview.mockResolvedValue({ rows: [], liveBooks: 0 });
});

describe("previewRemoval", () => {
  it("is for admins", async () => {
    admin = { ok: false, error: "Not authorized" };
    expect(await previewRemoval(member.id)).toEqual({ error: "Not authorized" });
    expect(preview).not.toHaveBeenCalled();
  });
  it("refuses an id that is not a member's", async () => {
    expect(await previewRemoval("nonsense")).toEqual({ error: "Member not found." });
  });
  it("returns the dry run", async () => {
    expect(await previewRemoval(member.id)).toEqual({ preview: { rows: [], liveBooks: 0 } });
  });
  it("hides the database's message when the dry run fails", async () => {
    preview.mockRejectedValue(new Error("secret detail"));
    expect(await previewRemoval(member.id)).toEqual({ error: "Couldn't load what would be removed." });
  });
});

describe("removeMember", () => {
  it("is for admins", async () => {
    admin = { ok: false, error: "Not authenticated" };
    expect(await removeMember(member.id, false, member.name)).toEqual({ error: "Not authenticated" });
    expect(removeOnRequest).not.toHaveBeenCalled();
  });

  it("refuses an id that is not a member's", async () => {
    expect(await removeMember("nonsense", false, "x")).toEqual({ error: "Member not found." });
  });

  it("refuses when the typed name doesn't match", async () => {
    expect(await removeMember(member.id, false, "Ada Exampl")).toEqual({ error: "The name you typed doesn't match this member's name." });
    expect(removeOnRequest).not.toHaveBeenCalled();
  });

  it("refuses a member that does not exist or was already removed", async () => {
    found = null;
    expect(await removeMember(member.id, false, member.name)).toEqual({ error: "Member not found." });
    found = { ...member, email: "removed-x@removed.invalid" };
    expect(await removeMember(member.id, false, member.name)).toEqual({ error: "This member was already removed." });
    expect(removeOnRequest).not.toHaveBeenCalled();
  });

  it("refuses to remove the admin's own record or another admin", async () => {
    found = { ...member, userId: "admin-user" };
    expect(await removeMember(member.id, false, member.name)).toEqual({ error: "You can't remove your own record." });
    found = { ...member };
    isAdmin.mockResolvedValue(true);
    expect(await removeMember(member.id, false, member.name)).toEqual({ error: "This member is an admin. Change their role first." });
    expect(removeOnRequest).not.toHaveBeenCalled();
  });

  it("removes with the member's answer about public work, and reports what is left over", async () => {
    removeOnRequest.mockResolvedValue({ ok: true, leftovers: ["delete the account"] });
    expect(await removeMember(member.id, true, ` ${member.name} `)).toEqual({ success: true, leftovers: ["delete the account"] });
    expect(removeOnRequest).toHaveBeenCalledWith(expect.anything(), member.id, true);
    expect(withAction).toHaveBeenCalledWith("member_removed", expect.any(Function), expect.any(Function));
  });

  it("tells staff nothing changed when the database part fails, without its message", async () => {
    removeOnRequest.mockResolvedValue({ ok: false, error: "internal detail" });
    expect(await removeMember(member.id, false, member.name)).toEqual({ error: "The removal failed and nothing was changed." });
  });

  it("counts a failed removal as not worked, and a finished one as worked", async () => {
    await removeMember(member.id, false, member.name);
    const classify = withAction.mock.calls[0][2]!;
    expect(classify({ success: true, leftovers: [] }).ok).toBe(true);
    expect(classify({ error: "x" }).ok).toBe(false);
  });
});
