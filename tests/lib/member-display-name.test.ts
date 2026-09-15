import { describe, it, expect } from "vitest";
import { getMemberDisplayName } from "@/lib/member-display-name";

describe("getMemberDisplayName", () => {
  it("returns the pen name when display_name is set", () => {
    expect(getMemberDisplayName({ name: "Erica Haraldsen", display_name: "Edy Hackett" })).toBe(
      "Edy Hackett"
    );
  });

  it("falls back to the legal name when display_name is null", () => {
    expect(getMemberDisplayName({ name: "Erica Haraldsen", display_name: null })).toBe(
      "Erica Haraldsen"
    );
  });

  it("falls back to the legal name when display_name is blank", () => {
    expect(getMemberDisplayName({ name: "Erica Haraldsen", display_name: "   " })).toBe(
      "Erica Haraldsen"
    );
  });

  it("falls back to the legal name when display_name is undefined", () => {
    expect(getMemberDisplayName({ name: "Erica Haraldsen" })).toBe("Erica Haraldsen");
  });
});
