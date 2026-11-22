import { describe, expect, it, vi } from "vitest";
import { decideStaff } from "@/lib/staff-guard";

const noMfa = async () => false;
const mfa = async () => true;

describe("decideStaff, the decision the three guards share", () => {
  it("lets a staff role with the permission through, as itself", async () => {
    await expect(decideStaff({ realRole: "conversion_specialist", permission: "pages.edit", mfaBlocked: noMfa })).resolves.toEqual({
      ok: true,
      role: "conversion_specialist",
      roles: ["conversion_specialist"],
      realRole: "conversion_specialist",
      realRoles: ["conversion_specialist"],
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
      roles: ["conversion_specialist"],
      realRole: "conversion_specialist",
      realRoles: ["conversion_specialist"],
      previewing: false,
    });
    expect(mfaBlocked).not.toHaveBeenCalled();
  });

  it("refuses for the second step only once the permission is held", async () => {
    await expect(decideStaff({ realRole: "community_manager", permission: "care.write", mfaBlocked: mfa })).resolves.toEqual({
      ok: false,
      reason: "mfa",
      role: "community_manager",
      roles: ["community_manager"],
      realRole: "community_manager",
      realRoles: ["community_manager"],
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

  describe("a person holding several roles", () => {
    it("may do what any of their roles allows (the union), and is the primary role", async () => {
      const roles = ["conversion_specialist", "community_manager"];
      await expect(decideStaff({ realRoles: roles, permission: "pages.edit", mfaBlocked: noMfa })).resolves.toEqual({
        ok: true,
        role: "community_manager",
        roles: ["community_manager", "conversion_specialist"],
        realRole: "community_manager",
        realRoles: ["community_manager", "conversion_specialist"],
      });
      await expect(decideStaff({ realRoles: roles, permission: "care.write", mfaBlocked: noMfa })).resolves.toMatchObject({ ok: true });
      await expect(decideStaff({ realRoles: roles, permission: "member.sudo", mfaBlocked: noMfa })).resolves.toMatchObject({ ok: false, reason: "forbidden", previewing: false });
    });

    it("counts a staff role among non-staff values, and refuses when none is staff", async () => {
      await expect(decideStaff({ realRoles: ["member", "owner", "community_manager"], permission: "care.read", mfaBlocked: noMfa })).resolves.toMatchObject({ ok: true, role: "community_manager" });
      await expect(decideStaff({ realRoles: ["member", "owner"], permission: "staff.access", mfaBlocked: noMfa })).resolves.toEqual({ ok: false, reason: "not_staff" });
      await expect(decideStaff({ realRoles: [], permission: "staff.access", mfaBlocked: noMfa })).resolves.toEqual({ ok: false, reason: "not_staff" });
    });

    it("keeps an assistant's withheld permission withheld, unless another role they hold grants it", async () => {
      await expect(decideStaff({ realRoles: ["assistant"], permission: "care.member_activity.read", mfaBlocked: noMfa })).resolves.toMatchObject({ ok: false, reason: "forbidden" });
      await expect(decideStaff({ realRoles: ["assistant", "conversion_specialist"], permission: "care.member_activity.read", mfaBlocked: noMfa })).resolves.toMatchObject({ ok: false, reason: "forbidden" });
      await expect(decideStaff({ realRoles: ["assistant", "community_manager"], permission: "care.member_activity.read", mfaBlocked: noMfa })).resolves.toMatchObject({ ok: true });
      await expect(decideStaff({ realRoles: ["assistant", "admin"], permission: "care.member_activity.read", mfaBlocked: noMfa })).resolves.toMatchObject({ ok: true });
    });

    it("previews as one role only, for someone who holds admin among their roles", async () => {
      await expect(decideStaff({ realRoles: ["community_manager", "admin"], previewRole: "conversion_specialist", permission: "care.write", mfaBlocked: noMfa })).resolves.toMatchObject({
        ok: false,
        reason: "forbidden",
        role: "conversion_specialist",
        roles: ["conversion_specialist"],
        realRole: "admin",
        previewing: true,
      });
      await expect(decideStaff({ realRoles: ["community_manager", "conversion_specialist"], previewRole: "assistant", permission: "pages.edit", mfaBlocked: noMfa })).resolves.toMatchObject({
        ok: true,
        roles: ["community_manager", "conversion_specialist"],
      });
    });

    it("asks about the second step only once a role holds the permission", async () => {
      const mfaBlocked = vi.fn(mfa);
      await decideStaff({ realRoles: ["community_manager", "conversion_specialist"], permission: "members.write", mfaBlocked });
      expect(mfaBlocked).not.toHaveBeenCalled();
      await expect(decideStaff({ realRoles: ["community_manager", "conversion_specialist"], permission: "pages.publish", mfaBlocked })).resolves.toMatchObject({ ok: false, reason: "mfa" });
    });
  });
});
