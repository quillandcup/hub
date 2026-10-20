import { describe, it, expect, vi, beforeEach } from "vitest";

const requireAdminAction = vi.fn();
vi.mock("@/lib/admin-auth", () => ({ requireAdminAction: () => requireAdminAction() }));

import { suggestFilterValues } from "@/app/(admin)/admin/analytics/explore/actions";

const rpc = vi.fn();

beforeEach(() => {
  rpc.mockReset();
  requireAdminAction.mockReset();
  requireAdminAction.mockResolvedValue({ ok: true, supabase: { rpc } });
});

describe("suggestFilterValues", () => {
  it("returns the values a declared property has, most frequent first, without blanks", async () => {
    rpc.mockResolvedValue({ data: [{ value: "Settings" }, { value: null }, { value: "Off air" }], error: null });
    expect(await suggestFilterValues("element_clicked", "text")).toEqual(["Settings", "Off air"]);
    expect(rpc).toHaveBeenCalledWith("analytics_property_breakdown", expect.objectContaining({ event_name: "element_clicked", property: "text" }));
  });

  it("caps how many it returns", async () => {
    rpc.mockResolvedValue({ data: Array.from({ length: 80 }, (_, i) => ({ value: `v${i}` })), error: null });
    expect(await suggestFilterValues("element_clicked", "text")).toHaveLength(30);
  });

  it("returns nothing, and asks the database nothing, for anyone but an admin", async () => {
    requireAdminAction.mockResolvedValue({ ok: false, error: "Not authorized" });
    expect(await suggestFilterValues("element_clicked", "text")).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown event", "made_up", "text"],
    ["an undeclared property", "element_clicked", "email"],
    ["a prototype key", "element_clicked", "constructor"],
  ])("returns nothing for %s", async (_label, event, property) => {
    expect(await suggestFilterValues(event, property)).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns nothing when the query fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await suggestFilterValues("element_clicked", "text")).toEqual([]);
  });
});
