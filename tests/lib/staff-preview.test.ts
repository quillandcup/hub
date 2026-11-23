import { describe, expect, it } from "vitest";
import { PREVIEWABLE_ROLES, PREVIEW_ROLE_LABELS, effectiveStaffRoles, parsePreviewRole } from "@/lib/staff-preview";
import { STAFF_ROLES } from "@/lib/permissions";

describe("parsePreviewRole", () => {
  it("accepts a previewable role and nothing else", () => {
    expect(parsePreviewRole("community_manager")).toBe("community_manager");
    expect(parsePreviewRole("conversion_specialist")).toBe("conversion_specialist");
    expect(parsePreviewRole("assistant")).toBe("assistant");
    for (const value of ["admin", "member", "", null, undefined]) expect(parsePreviewRole(value)).toBeNull();
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
