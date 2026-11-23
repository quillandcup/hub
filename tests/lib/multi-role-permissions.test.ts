import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSIONS,
  ASSISTANT_WITHHELD,
  ROLE_PERMISSIONS,
  STAFF_ROLES,
  can,
  hasAdminLikeRole,
  primaryRole,
  rolesOf,
  staffHome,
  staffRolesIn,
  type Permission,
} from "@/lib/permissions";
import { mayOpenAdminPath } from "@/lib/admin-paths";
import { navGroups } from "@/lib/site-pages";
import { staffCan, staffFeaturesFor } from "@/lib/staff-access";

/** A person can hold several roles: what they may do is the union, and the old single-role answers do not change. */

describe("the roles a person holds", () => {
  it("lists the staff roles in a set, deduplicated, highest priority first", () => {
    expect(staffRolesIn(["conversion_specialist", "admin", "conversion_specialist", "community_manager"])).toEqual(["admin", "community_manager", "conversion_specialist"]);
    expect(staffRolesIn("assistant")).toEqual(["assistant"]);
  });

  it.each([null, undefined, "", "member", "owner", [], ["member", "owner", null]])("finds no staff role in %j", (input) => {
    expect(staffRolesIn(input as never)).toEqual([]);
    expect(primaryRole(input as never)).toBeNull();
  });

  it("puts the priority in the order of STAFF_ROLES: admin, assistant, community manager, conversion specialist", () => {
    expect([...STAFF_ROLES]).toEqual(["admin", "assistant", "community_manager", "conversion_specialist"]);
    expect(primaryRole(["conversion_specialist", "community_manager"])).toBe("community_manager");
    expect(primaryRole(["community_manager", "assistant"])).toBe("assistant");
    expect(primaryRole(["assistant", "admin"])).toBe("admin");
  });

  it("reads an actor's roles from `roles` only, and ignores a lone `role`", () => {
    expect(rolesOf({ roles: ["conversion_specialist", "community_manager"] })).toEqual(["community_manager", "conversion_specialist"]);
    expect(rolesOf({ roles: ["assistant"] })).toEqual(["assistant"]);
    expect(rolesOf({ role: "admin", roles: [] } as never)).toEqual([]);
    expect(rolesOf(null)).toEqual([]);
  });
});

describe("can() with several roles is the union", () => {
  const holds = (roles: string[]) => ALL_PERMISSIONS.filter((permission) => can({ roles }, permission));

  it("gives a person with two roles exactly the permissions of either", () => {
    const union = new Set<Permission>([...ROLE_PERMISSIONS.community_manager, ...ROLE_PERMISSIONS.conversion_specialist]);
    expect(new Set(holds(["community_manager", "conversion_specialist"]))).toEqual(union);
    expect(can({ roles: ["community_manager", "conversion_specialist"] }, "care.write")).toBe(true);
    expect(can({ roles: ["community_manager", "conversion_specialist"] }, "pages.publish")).toBe(true);
    expect(can({ roles: ["community_manager", "conversion_specialist"] }, "pages.delete")).toBe(false);
    expect(can({ roles: ["community_manager", "conversion_specialist"] }, "member.sudo")).toBe(false);
  });

  it("gives a single role exactly the permissions of its bundle", () => {
    for (const role of STAFF_ROLES) expect(new Set(holds([role])), role).toEqual(new Set(ROLE_PERMISSIONS[role]));
  });

  it("lets the admin imply everything, whatever else is held", () => {
    expect(holds(["admin", "conversion_specialist"])).toEqual(ALL_PERMISSIONS);
    expect(holds(["community_manager", "admin"])).toEqual(ALL_PERMISSIONS);
  });

  it("keeps what is withheld from the assistant withheld, unless another role they hold grants it", () => {
    for (const permission of ASSISTANT_WITHHELD) {
      expect(can({ roles: ["assistant"] }, permission)).toBe(false);
      expect(can({ roles: ["assistant", "conversion_specialist"] }, permission)).toBe(false);
      expect(can({ roles: ["assistant", "admin"] }, permission)).toBe(true);
    }
    // the community manager holds care.member_activity.read on purpose (the privacy page says admins and community managers).
    expect(can({ roles: ["assistant", "community_manager"] }, "care.member_activity.read")).toBe(true);
  });

  it("holds nothing for no roles, a member or an unknown role", () => {
    expect(holds([])).toEqual([]);
    expect(holds(["member", "owner"])).toEqual([]);
    expect(can(null, "staff.access")).toBe(false);
  });

});

describe("where a person lands, and which pages open", () => {
  it("lands on the primary role's home", () => {
    expect(staffHome(["conversion_specialist", "community_manager"])).toBe("/admin/at-risk");
    expect(staffHome(["conversion_specialist"])).toBe("/admin/pages");
    expect(staffHome(["community_manager", "assistant"])).toBe("/admin");
    expect(staffHome("community_manager")).toBe("/admin/at-risk");
    expect(staffHome([])).toBe("/admin");
    expect(staffHome(undefined)).toBe("/admin");
  });

  it("opens a page when any role opens it", () => {
    const roles = ["community_manager", "conversion_specialist"];
    expect(mayOpenAdminPath(roles, "/admin/at-risk")).toBe(true);
    expect(mayOpenAdminPath(roles, "/admin/pages")).toBe(true);
    expect(mayOpenAdminPath(roles, "/admin/users")).toBe(false);
    expect(mayOpenAdminPath(["conversion_specialist"], "/admin/at-risk")).toBe(false);
    expect(mayOpenAdminPath([], "/admin")).toBe(false);
    expect(mayOpenAdminPath("community_manager", "/admin/at-risk")).toBe(true);
  });

  it("opens an unlisted page only for the admin or the assistant among the roles", () => {
    expect(mayOpenAdminPath(["community_manager", "conversion_specialist"], "/admin/never-listed")).toBe(false);
    expect(mayOpenAdminPath(["community_manager", "assistant"], "/admin/never-listed")).toBe(true);
    expect(hasAdminLikeRole(["conversion_specialist", "admin"])).toBe(true);
    expect(hasAdminLikeRole(["community_manager"])).toBe(false);
  });

  it("shows the sidebar pages of every role held", () => {
    const hrefs = (roles: string[]) => navGroups("admin", [], roles).flatMap((g) => g.items.map((p) => p.href));
    const both = hrefs(["community_manager", "conversion_specialist"]);
    for (const href of [...hrefs(["community_manager"]), ...hrefs(["conversion_specialist"])]) expect(both).toContain(href);
    expect(both).toContain("/admin/at-risk");
    expect(both).toContain("/admin/pages");
    expect(both).not.toContain("/admin/users");
  });

  it("finds the staff features of any role held", () => {
    expect(staffCan({ roles: ["conversion_specialist", "community_manager"] }, "care.write")).toBe(true);
    expect(staffCan({ roles: ["conversion_specialist"] }, "care.write")).toBe(false);
    expect(staffCan({ roles: ["community_manager"] }, "care.write")).toBe(true);
    expect(staffFeaturesFor({ roles: ["conversion_specialist", "community_manager"] })).toEqual(staffFeaturesFor({ roles: ["community_manager"] }));
  });
});

describe("the priority order is the same in SQL", () => {
  it("lists the roles in the migration's staff_role_rank() in the order of STAFF_ROLES", () => {
    const sql = readFileSync("supabase/migrations/20271028000000_user_roles.sql", "utf8");
    const match = /FUNCTION public\.staff_role_rank[\s\S]*?array_position\(ARRAY\[([^\]]+)\]/.exec(sql);
    expect(match).not.toBeNull();
    const ranked = match![1].split(",").map((s) => s.trim().replace(/'/g, ""));
    expect(ranked).toEqual([...STAFF_ROLES]);
  });
});
