import { describe, expect, it } from "vitest";
import { effectiveStaffRole, parsePreviewRole } from "@/lib/staff-preview";

describe("parsePreviewRole", () => {
  it("accepts a previewable role and nothing else", () => {
    expect(parsePreviewRole("community_manager")).toBe("community_manager");
    expect(parsePreviewRole("conversion_specialist")).toBe("conversion_specialist");
    for (const value of ["admin", "assistant", "member", "", null, undefined]) expect(parsePreviewRole(value)).toBeNull();
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
