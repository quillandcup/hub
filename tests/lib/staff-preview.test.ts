import { describe, expect, it } from "vitest";
import { PREVIEWABLE_ROLES, PREVIEW_ROLE_LABELS, effectiveStaffRole, effectiveStaffRoles, parsePreviewRole } from "@/lib/staff-preview";
import { STAFF_ROLES } from "@/lib/permissions";

describe("parsePreviewRole", () => {
  it("accepts a previewable role and nothing else", () => {
    expect(parsePreviewRole("community_manager")).toBe("community_manager");
    expect(parsePreviewRole("conversion_specialist")).toBe("conversion_specialist");
    expect(parsePreviewRole("assistant")).toBe("assistant");
    for (const value of ["admin", "member", "", null, undefined]) expect(parsePreviewRole(value)).toBeNull();
  });
});

describe("effectiveStaffRole", () => {
  it("lowers a real admin to the previewed role", () => {
    expect(effectiveStaffRole("admin", "community_manager")).toBe("community_manager");
    expect(effectiveStaffRole("admin", "conversion_specialist")).toBe("conversion_specialist");
  });

  it("leaves an admin alone with no or an unknown preview", () => {
    expect(effectiveStaffRole("admin", undefined)).toBe("admin");
    expect(effectiveStaffRole("admin", "admin")).toBe("admin");
  });

  it("never changes anyone who isn't an admin", () => {
    expect(effectiveStaffRole("member", "community_manager")).toBe("member");
    expect(effectiveStaffRole("conversion_specialist", "community_manager")).toBe("conversion_specialist");
    expect(effectiveStaffRole(null, "community_manager")).toBeNull();
    expect(effectiveStaffRole(undefined, "community_manager")).toBeUndefined();
  });
});

describe("PREVIEWABLE_ROLES", () => {
  it("is every staff role below the admin, each with a label, so a new role needs no UI change", () => {
    expect([...PREVIEWABLE_ROLES]).toEqual(STAFF_ROLES.filter((role) => role !== "admin"));
    for (const role of PREVIEWABLE_ROLES) expect(PREVIEW_ROLE_LABELS[role].length).toBeGreaterThan(3);
  });
});

describe("effectiveStaffRoles", () => {
  it("lowers someone holding admin to the one previewed role", () => {
    expect(effectiveStaffRoles(["admin", "community_manager"], "conversion_specialist")).toEqual(["conversion_specialist"]);
  });

  it("keeps every role when nothing valid is previewed, or when the person does not hold admin", () => {
    expect(effectiveStaffRoles(["admin", "community_manager"], undefined)).toEqual(["admin", "community_manager"]);
    expect(effectiveStaffRoles(["admin"], "owner")).toEqual(["admin"]);
    expect(effectiveStaffRoles(["community_manager", "conversion_specialist"], "assistant")).toEqual(["community_manager", "conversion_specialist"]);
  });

  it("passes no roles through", () => {
    expect(effectiveStaffRoles(null, "assistant")).toBeNull();
    expect(effectiveStaffRoles(undefined, "assistant")).toBeUndefined();
  });
});
