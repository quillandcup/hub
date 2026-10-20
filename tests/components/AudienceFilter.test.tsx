// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AudienceFilter } from "@/components/admin/AudienceFilter";

const hrefOf = (name: RegExp) => new URL(screen.getByRole("link", { name }).getAttribute("href")!, "http://x");

describe("AudienceFilter", () => {
  it("shows ignore-sudo on and ignore-staff off by default, and each link flips only its own filter", () => {
    render(<AudienceFilter path="/admin/analytics" params={{}} audience={{ ignoreStaff: false, ignoreSudo: true }} />);
    expect(screen.getByRole("link", { name: /Ignore staff$/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("link", { name: /Ignore staff in sudo/ })).toHaveAttribute("aria-pressed", "true");

    const staff = hrefOf(/Ignore staff$/);
    expect(staff.pathname).toBe("/admin/analytics");
    expect(staff.searchParams.get("staff")).toBe("hide");
    expect(staff.searchParams.has("sudo")).toBe(false);

    const sudo = hrefOf(/Ignore staff in sudo/);
    expect(sudo.searchParams.get("sudo")).toBe("show");
    expect(sudo.searchParams.has("staff")).toBe(false);
  });

  it("turning a filter back to its default drops it from the address, and every other parameter is kept", () => {
    render(
      <AudienceFilter
        path="/admin/analytics/explore"
        params={{ days: "7", step: ["a", "b"], route: undefined, staff: "hide", sudo: "show" }}
        audience={{ ignoreStaff: true, ignoreSudo: false }}
      />
    );
    const staff = hrefOf(/Ignore staff$/);
    expect(staff.searchParams.has("staff")).toBe(false);
    expect(staff.searchParams.get("sudo")).toBe("show");
    expect(staff.searchParams.get("days")).toBe("7");
    expect(staff.searchParams.getAll("step")).toEqual(["a", "b"]);

    const sudo = hrefOf(/Ignore staff in sudo/);
    expect(sudo.searchParams.has("sudo")).toBe(false);
    expect(sudo.searchParams.get("staff")).toBe("hide");
  });

  it("links to the bare path when nothing is left to say", () => {
    render(<AudienceFilter path="/admin/analytics" params={{ staff: "hide" }} audience={{ ignoreStaff: true, ignoreSudo: true }} />);
    expect(screen.getByRole("link", { name: /Ignore staff$/ })).toHaveAttribute("href", "/admin/analytics");
  });
});
