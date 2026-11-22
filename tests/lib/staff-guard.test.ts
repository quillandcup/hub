import { describe, expect, it, vi } from "vitest";
import { decideStaff } from "@/lib/staff-guard";

const noMfa = async () => false;
const mfa = async () => true;

describe("decideStaff, the decision the three guards share", () => {
  it("lets a staff role with the permission through, as itself", async () => {
    await expect(decideStaff({ realRole: "conversion_specialist", permission: "pages.edit", mfaBlocked: noMfa })).resolves.toEqual({
      ok: true,
      role: "conversion_specialist",
      realRole: "conversion_specialist",
    });
  });

  it.each(["member", "", null, undefined, "owner"])("refuses the role %s as not staff, without asking about the second step", async (realRole) => {
    const mfaBlocked = vi.fn(noMfa);
    await expect(decideStaff({ realRole, permission: "staff.access", mfaBlocked })).resolves.toEqual({ ok: false, reason: "not_staff" });
    expect(mfaBlocked).not.toHaveBeenCalled();
  });

  it("refuses a staff role without the permission, before the second step", async () => {
    const mfaBlocked = vi.fn(mfa);
    await expect(decideStaff({ realRole: "conversion_specialist", permission: "members.read", mfaBlocked })).resolves.toEqual({
      ok: false,
      reason: "forbidden",
      role: "conversion_specialist",
      realRole: "conversion_specialist",
      previewing: false,
    });
    expect(mfaBlocked).not.toHaveBeenCalled();
  });

  it("refuses for the second step only once the permission is held", async () => {
    await expect(decideStaff({ realRole: "community_manager", permission: "care.write", mfaBlocked: mfa })).resolves.toEqual({
      ok: false,
      reason: "mfa",
      role: "community_manager",
      realRole: "community_manager",
    });
  });

  it("checks a real admin as the role they preview, and says they are previewing", async () => {
    await expect(decideStaff({ realRole: "admin", previewRole: "conversion_specialist", permission: "pages.edit", mfaBlocked: noMfa })).resolves.toMatchObject({
      ok: true,
      role: "conversion_specialist",
      realRole: "admin",
    });
    await expect(decideStaff({ realRole: "admin", previewRole: "conversion_specialist", permission: "members.read", mfaBlocked: noMfa })).resolves.toMatchObject({
      ok: false,
      reason: "forbidden",
      previewing: true,
    });
  });

  it("ignores a preview for anyone who isn't an admin", async () => {
    await expect(decideStaff({ realRole: "community_manager", previewRole: "assistant", permission: "system.users.manage", mfaBlocked: noMfa })).resolves.toMatchObject({
      ok: false,
      reason: "forbidden",
      role: "community_manager",
      previewing: false,
    });
  });
});
