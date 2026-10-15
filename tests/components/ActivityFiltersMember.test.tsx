// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ActivityFilters from "@/app/(admin)/admin/activity/ActivityFilters";
import { MEMBER_DEFAULTS, parseFeedFilters } from "@/lib/activity-feed";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const BASE = "/admin/members/m1/activity";
const filters = { ...parseFeedFilters({}, MEMBER_DEFAULTS), memberId: "11111111-1111-4111-8111-111111111111" };

describe("ActivityFilters, member variant", () => {
  it("has no pickers and no Privacy view, but keeps the views, range and system/Slack toggles", () => {
    render(<ActivityFilters variant="member" filters={filters} basePath={BASE} />);
    expect(screen.queryByText("Staff member")).toBeNull();
    expect(screen.queryByPlaceholderText("Search members...")).toBeNull();
    expect(screen.queryByText("Privacy")).toBeNull();
    expect(screen.getByRole("link", { name: "Audit" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Everything" })).toBeInTheDocument();
  });

  it("links stay on the member's tab, never put the member in the query, and toggle off from the defaults", () => {
    render(<ActivityFilters variant="member" filters={filters} basePath={BASE} />);
    expect(screen.getByRole("link", { name: "Hide system" })).toHaveAttribute("href", `${BASE}?nosystem=1`);
    expect(screen.getByRole("link", { name: "Hide Slack" })).toHaveAttribute("href", `${BASE}?noslack=1`);
    expect(screen.getByRole("link", { name: "Audit" })).toHaveAttribute("href", `${BASE}?view=audit`);
    expect(screen.getByRole("link", { name: "Everything" })).toHaveAttribute("href", BASE);
    expect(screen.getByRole("link", { name: "7d" })).toHaveAttribute("href", `${BASE}?days=7`);
  });

  it("shows an active toggle as pressed and turns it back off", () => {
    render(<ActivityFilters variant="member" filters={{ ...filters, hideSlack: true }} basePath={BASE} />);
    const slack = screen.getByRole("link", { name: "Hide Slack" });
    expect(slack).toHaveAttribute("aria-pressed", "true");
    expect(slack).toHaveAttribute("href", BASE);
  });
});
