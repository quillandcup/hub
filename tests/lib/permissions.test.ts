import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSIONS,
  ASSISTANT_WITHHELD,
  PERMISSIONS,
  RESERVED_PERMISSIONS,
  ROLE_PERMISSIONS,
  STAFF_ROLES,
  can,
  isStaffRole,
  staffHome,
  type Permission,
  type StaffRole,
} from "@/lib/permissions";
import { isAdminPath, mayOpenAdminPath, permissionForAdminPath } from "@/lib/admin-paths";
import { SITE_PAGES } from "@/lib/site-pages";
import { STAFF_FEATURES, staffCan, staffFeaturesFor } from "@/lib/staff-access";

type LimitedRole = "community_manager" | "conversion_specialist";

/**
 * The decision for every permission, written out: which of the two limited roles holds it. The admin and the
 * assistant hold all of them but ASSISTANT_WITHHELD (asserted below). `Record<Permission, ...>` makes a new permission fail the typecheck
 * until someone decides it here, and an empty list is the deliberate "admin and assistant only".
 */
const GRANTED: Record<Permission, readonly LimitedRole[]> = {
  "staff.access": ["community_manager", "conversion_specialist"],
  "dashboard.read": [],
  "activity.read": [],
  "changelog.read": [],
  "changelog.edit": [],
  "members.read": ["community_manager"],
  "members.write": [],
  "members.network.read": [],
  "members.overrides.manage": [],
  "members.at_risk.read": ["community_manager"],
  "members.bulk_merge": [],
  "member.sudo": [],
  "member.merge": [],
  "member.split": [],
  "member.remove": [],
  "member.notes_write": [],
  "member.timeline_edit": [],
  "member.badges_edit": [],
  "member.account_tab": [],
  "member.activity_tab": [],
  "member.activity_tab_limited": ["community_manager"],
  "member.billing_links": [],
  "member.record_history": [],
  "member.push_devices": [],
  "member.status_overrides": [],
  "member.alias_admin": [],
  "calendar.read": ["community_manager"],
  "prickles.read": ["community_manager"],
  "prickles.manage": [],
  "prickle.edit": [],
  "prickle.show_in_events": [],
  "prickle.test_dms": [],
  "prickle.ignore_names": [],
  "prickle.alias_form": [],
  "prickle.insights_link": [],
  "care.read": ["community_manager"],
  "care.write": ["community_manager"],
  "care.takeover": [],
  "care.member_activity.read": ["community_manager"],
  "courses.manage": [],
  "programs.manage": [],
  "mentorship.manage": [],
  "badges.manage": [],
  "events.manage": [],
  "community.manage": [],
  "media.read": ["conversion_specialist"],
  "media.manage": [],
  "pages.read": ["conversion_specialist"],
  "pages.edit": ["conversion_specialist"],
  "pages.publish": ["conversion_specialist"],
  "pages.delete": [],
  "outreach.manage": ["conversion_specialist"],
  "offers.manage": [],
  "email.send": ["conversion_specialist"],
  "email.schedule": ["conversion_specialist"],
  "announcements.manage": ["conversion_specialist"],
  "analytics.usage.read": [],
  "analytics.community.read": ["community_manager"],
  "analytics.engagement.read": ["community_manager"],
  "analytics.resubscriptions.read": ["community_manager"],
  "analytics.prickles.read": [],
  "analytics.cohorts.read": ["conversion_specialist"],
  "data.export": [],
  "data.pipeline.run": [],
  "data.hygiene.manage": [],
  "system.users.manage": [],
  "roles.read": [],
  "system.compliance.read": [],
  "system.previews.manage": [],
  "system.feedback.manage": [],
  "system.integrations.manage": [],
  "system.dev_tools.use": [],
  "system.search.use": [],
  "system.internal.run": [],
};

const LIMITED: LimitedRole[] = ["community_manager", "conversion_specialist"];

describe("the role x permission matrix", () => {
  const cases = STAFF_ROLES.flatMap((role) => ALL_PERMISSIONS.map((permission) => [role, permission] as const));

  it("covers every role and every permission", () => {
    expect(Object.keys(GRANTED).sort()).toEqual([...ALL_PERMISSIONS].sort());
    expect(cases).toHaveLength(STAFF_ROLES.length * ALL_PERMISSIONS.length);
  });

  it.each(cases)("%s x %s", (role, permission) => {
    const expected =
      role === "admin" ? true : role === "assistant" ? !ASSISTANT_WITHHELD.includes(permission) : GRANTED[permission].includes(role);
    expect(can({ roles: [role] }, permission)).toBe(expected);
  });

  it("gives the admin every permission, and the assistant the admin's list by construction, less what is withheld", () => {
    expect([...ROLE_PERMISSIONS.admin].sort()).toEqual([...ALL_PERMISSIONS].sort());
    expect([...ROLE_PERMISSIONS.assistant].sort()).toEqual(ALL_PERMISSIONS.filter((p) => !ASSISTANT_WITHHELD.includes(p)).sort());
  });

  it("withholds from the assistant only what the privacy page keeps from it: a member's tracked DMs and plan activity in Hedgie Care", () => {
    expect([...ASSISTANT_WITHHELD]).toEqual(["care.member_activity.read"]);
    expect(can({ roles: ["assistant"] }, "care.write")).toBe(true);
    expect(can({ roles: ["assistant"] }, "care.member_activity.read")).toBe(false);
    expect(can({ roles: ["community_manager"] }, "care.member_activity.read")).toBe(true);
  });

  it("keeps each limited role's bundle equal to its column in the table", () => {
    for (const role of LIMITED) {
      const written = ALL_PERMISSIONS.filter((p) => GRANTED[p].includes(role));
      expect([...ROLE_PERMISSIONS[role]].sort()).toEqual(written.sort());
    }
  });

  it("gives every limited role the staff area and not the dashboard", () => {
    for (const role of LIMITED) {
      expect(can({ roles: [role] }, "staff.access")).toBe(true);
      expect(can({ roles: [role] }, "dashboard.read")).toBe(false);
    }
  });
});

// The rule in .claude/rules/permissions-for-resources.md: every permission has a decision for every role.
// These say which permission or role is the problem, instead of a bare list diff.
describe("every permission has a decision for every role", () => {
  const decided = Object.keys(GRANTED);

  it("has a row in the decision table for each permission", () => {
    const missing = ALL_PERMISSIONS.filter((p) => !decided.includes(p));
    expect(missing, `no decision in GRANTED (tests/lib/permissions.test.ts) for: ${missing.join(", ")}. Decide each role: [] means admin and assistant only.`).toEqual([]);
  });

  it("has no row for a permission that does not exist", () => {
    const unknown = decided.filter((p) => !(p in PERMISSIONS));
    expect(unknown, `GRANTED names permissions that are not in PERMISSIONS: ${unknown.join(", ")}`).toEqual([]);
  });

  it("decides only with roles that exist", () => {
    for (const [permission, roles] of Object.entries(GRANTED)) {
      for (const role of roles) expect(STAFF_ROLES as readonly string[], `${permission} is granted to unknown role ${role}`).toContain(role);
    }
  });

  it("has a bundle for every staff role, holding only permissions that exist and each at most once", () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort(), "ROLE_PERMISSIONS needs exactly one entry per staff role").toEqual([...STAFF_ROLES].sort());
    for (const role of STAFF_ROLES) {
      const bundle = ROLE_PERMISSIONS[role];
      const unknown = bundle.filter((p) => !(p in PERMISSIONS));
      expect(unknown, `role ${role} holds unknown permissions: ${unknown.join(", ")}`).toEqual([]);
      expect(new Set(bundle).size, `role ${role} lists a permission twice`).toBe(bundle.length);
    }
  });

  it("describes each permission in a sentence, not a blank or a placeholder", () => {
    for (const [id, description] of Object.entries(PERMISSIONS)) {
      expect(description.trim(), `${id} needs a description`).toMatch(/\S{3,}/);
      expect(description, `${id}: description must not be a TODO placeholder`).not.toMatch(/^(todo|tbd|\?+)/i);
    }
  });
});

describe("the community manager is exactly what the role was before the registry", () => {
  it("opens the same pages and holds the same finer features", () => {
    expect([...ROLE_PERMISSIONS.community_manager].sort()).toEqual(
      [
        "analytics.community.read",
        "analytics.engagement.read",
        "analytics.resubscriptions.read",
        "calendar.read",
        "care.member_activity.read",
        "care.read",
        "care.write",
        "member.activity_tab_limited",
        "members.at_risk.read",
        "members.read",
        "prickles.read",
        "staff.access",
      ].sort()
    );
  });
});

describe("the conversion specialist", () => {
  const specialist = { roles: ["conversion_specialist"] };

  it("edits and publishes landing pages, runs outreach, and sends and schedules email and announcements", () => {
    for (const permission of ["pages.read", "pages.edit", "pages.publish", "outreach.manage", "email.send", "email.schedule", "announcements.manage"] as const) {
      expect(can(specialist, permission), permission).toBe(true);
    }
  });

  it("reads conversion and retention cohorts, and only that of the analytics", () => {
    expect(can(specialist, "analytics.cohorts.read")).toBe(true);
    for (const permission of ALL_PERMISSIONS.filter((p) => p.startsWith("analytics.") && p !== "analytics.cohorts.read")) {
      expect(can(specialist, permission), permission).toBe(false);
    }
  });

  it("has no members area: no list, page, notes, contact data, merge, override or sudo", () => {
    const membersArea = ALL_PERMISSIONS.filter((p) => p.startsWith("member.") || p.startsWith("members."));
    expect(membersArea.length).toBeGreaterThan(15);
    for (const permission of membersArea) expect(can(specialist, permission), permission).toBe(false);
    for (const permission of ["member.sudo", "member.merge", "member.split", "member.remove", "member.notes_write", "members.overrides.manage", "member.account_tab"] as const) {
      expect(can(specialist, permission), permission).toBe(false);
    }
  });

  it("cannot edit the changelog or read its engineering pages", () => {
    expect(can(specialist, "changelog.edit")).toBe(false);
    expect(can(specialist, "changelog.read")).toBe(false);
  });

  it("cannot export data, run the data pipeline or manage users", () => {
    expect(can(specialist, "data.export")).toBe(false);
    expect(can(specialist, "data.pipeline.run")).toBe(false);
    expect(can(specialist, "system.users.manage")).toBe(false);
  });

  it("cannot delete a landing page (the admin and the assistant can)", () => {
    expect(can(specialist, "pages.delete")).toBe(false);
    expect(can({ roles: ["admin"] }, "pages.delete")).toBe(true);
  });

  it("opens only its own pages in the admin area", () => {
    for (const path of ["/admin", "/admin/pages", "/admin/pages/new", "/admin/pages/some-page", "/admin/pages/some-page/preview", "/admin/pages/design", "/admin/pages/templates", "/admin/outreach", "/admin/outreach/prospects"]) {
      expect(mayOpenAdminPath("conversion_specialist", path), path).toBe(true);
    }
    for (const path of ["/admin/members", "/admin/members/mbr_x", "/admin/members/network", "/admin/changelog", "/admin/changelog/some-entry", "/admin/users", "/admin/stats", "/admin/care", "/admin/activity", "/admin/data/import", "/admin/insights/resubscriptions", "/admin/media", "/admin/new-unlisted-page"]) {
      expect(mayOpenAdminPath("conversion_specialist", path), path).toBe(false);
    }
  });

  it("starts on the landing pages list", () => {
    expect(staffHome("conversion_specialist")).toBe("/admin/pages");
    expect(mayOpenAdminPath("conversion_specialist", staffHome("conversion_specialist"))).toBe(true);
  });
});

describe("can()", () => {
  it.each(["member", "", "Admin", "owner", null, undefined])("grants nothing to the role %s", (role) => {
    expect(isStaffRole(role)).toBe(false);
    for (const permission of ALL_PERMISSIONS) expect(can({ roles: [role] }, permission)).toBe(false);
  });

  it("grants nothing to nobody", () => {
    expect(can(null, "staff.access")).toBe(false);
    expect(can(undefined, "staff.access")).toBe(false);
    expect(can({}, "staff.access")).toBe(false);
  });

  it("accepts anything with roles (a staff user, an action's auth)", () => {
    const staffUser = { role: "admin", roles: ["admin"], id: "user-1", email: "a@example.test" };
    expect(can(staffUser, "members.read")).toBe(true);
  });
});

describe("the registry", () => {
  it("names permissions <area>.<action> in lowercase, each with a description", () => {
    for (const [id, description] of Object.entries(PERMISSIONS)) {
      expect(id, id).toMatch(/^[a-z_]+(\.[a-z_]+){1,2}$/);
      expect(description.length, id).toBeGreaterThan(10);
    }
  });

  it("reserves only permissions that exist, and says so in their description", () => {
    for (const permission of RESERVED_PERMISSIONS) {
      expect(ALL_PERMISSIONS).toContain(permission);
      expect(PERMISSIONS[permission], permission).toMatch(/reserved|no (admin )?surface yet/);
    }
  });

  it("lists every staff role, and a role's home is a page that role opens", () => {
    expect([...STAFF_ROLES]).toEqual(["admin", "assistant", "community_manager", "conversion_specialist"]);
    for (const role of STAFF_ROLES as readonly StaffRole[]) expect(mayOpenAdminPath(role, staffHome(role)), role).toBe(true);
  });
});

describe("the staff features are permissions", () => {
  it("all exist in the registry", () => {
    for (const feature of STAFF_FEATURES) expect(ALL_PERMISSIONS).toContain(feature);
  });

  it("gives an admin every feature, and a community manager only the ones in its bundle", () => {
    expect(staffFeaturesFor({ roles: ["admin"] })).toEqual(STAFF_FEATURES);
    expect(staffCan({ roles: ["admin"] }, "member.sudo")).toBe(true);
    expect(staffFeaturesFor({ roles: ["community_manager"] })).toEqual(["member.activity_tab_limited", "care.write"].sort((a, b) => STAFF_FEATURES.indexOf(a as never) - STAFF_FEATURES.indexOf(b as never)));
    expect(staffCan({ roles: ["community_manager"] }, "member.activity_tab")).toBe(false);
  });

  it.each(["member", "conversion_specialist", null, undefined, ""])("gives the role %s no feature", (role) => {
    expect(staffFeaturesFor({ roles: [role] })).toEqual([]);
  });
});

describe("which admin page needs which permission", () => {
  it("gives every listed admin page a permission, or leaves it to the admin and the assistant on purpose", () => {
    const unlisted = SITE_PAGES.filter((p) => p.audience === "admin" && isAdminPath(p.href) && !permissionForAdminPath(p.href)).map((p) => p.href);
    expect(unlisted).toEqual([]);
  });

  it("opens the pages a community manager always could, and closes the rest", () => {
    for (const path of [
      "/admin",
      "/admin/at-risk",
      "/admin/at-risk/",
      "/admin/stats",
      "/admin/calendar",
      "/admin/members",
      "/admin/members/mbr_AAAAAAAAAAA1",
      "/admin/members/mbr_AAAAAAAAAAA1/attendance",
      "/admin/members/mbr_AAAAAAAAAAA1/slack",
      "/admin/members/mbr_AAAAAAAAAAA1/activity",
      "/admin/insights/slack-engagement",
      "/admin/insights/resubscriptions",
      "/admin/prickles/prkl_AAAAAAAAAAA1",
      "/admin/care",
      "/admin/care/earlier",
    ]) {
      expect(mayOpenAdminPath("community_manager", path), path).toBe(true);
    }
    for (const path of [
      "/admin/users",
      "/admin/activity",
      "/admin/analytics",
      "/admin/insights/prickles",
      "/admin/members/network",
      "/admin/members/network/anything",
      "/admin/members/mbr_AAAAAAAAAAA1/account",
      "/admin/members/mbr_AAAAAAAAAAA1/identity",
      "/admin/members/mbr_AAAAAAAAAAA1/notifications",
      "/admin/prickles",
      "/admin/data/import",
      "/admin/work-queue",
      "/admin/pages",
      "/admin/outreach",
      "/administrivia",
      "/dashboard",
    ]) {
      expect(mayOpenAdminPath("community_manager", path), path).toBe(false);
    }
  });

  it("opens every admin path to the admin and the assistant, even one nobody has listed, and to no one else", () => {
    for (const role of ["community_manager", "conversion_specialist"]) expect(mayOpenAdminPath(role, "/admin/a-page-nobody-listed")).toBe(false);
    for (const role of ["admin", "assistant"]) {
      expect(mayOpenAdminPath(role, "/admin/users")).toBe(true);
      expect(mayOpenAdminPath(role, "/admin/a-page-nobody-listed")).toBe(true);
    }
  });

  it.each(["member", null, undefined, ""])("opens nothing to the role %s", (role) => {
    expect(mayOpenAdminPath(role, "/admin/at-risk")).toBe(false);
    expect(mayOpenAdminPath(role, "/admin")).toBe(false);
  });

  it("ignores a trailing slash and a path that only looks like an admin path", () => {
    expect(permissionForAdminPath("/admin/pages/")).toBe("pages.read");
    expect(permissionForAdminPath("/admin/pages/some-page")).toBe("pages.edit");
    expect(permissionForAdminPath("/admin/pages/some-page/preview")).toBe("pages.read");
    expect(permissionForAdminPath("/administrivia")).toBeUndefined();
  });
});
