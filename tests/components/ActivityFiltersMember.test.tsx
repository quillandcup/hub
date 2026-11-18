// @vitest-environment jsdom
import { beforeEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ActivityFilters from "@/app/(admin)/admin/activity/ActivityFilters";
import { MEMBER_DEFAULTS, parseFeedFilters } from "@/lib/activity-feed";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const BASE = "/admin/members/m1/activity";
const NOW = new Date("2026-11-17T15:00:00Z");
const filters = { ...parseFeedFilters({}, MEMBER_DEFAULTS, NOW), memberId: "11111111-1111-4111-8111-111111111111" };

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

describe("ActivityFilters, member variant, limited (a community manager)", () => {
  it("offers no Audit or Everything switch and no type chips, only range, Viewed as member and the hide toggles", () => {
    render(<ActivityFilters variant="member" limited filters={filters} basePath={BASE} />);
    expect(screen.queryByRole("link", { name: "Audit" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Everything" })).toBeNull();
    expect(screen.queryByText("All types")).toBeNull();
    expect(screen.queryByText("Changes")).toBeNull();
    expect(screen.queryByText("Page visits")).toBeNull();
    expect(screen.getByRole("link", { name: "30d" })).toHaveAttribute("href", `${BASE}?days=30`);
    expect(screen.getByRole("link", { name: "Viewed as member" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Hide system" })).toHaveAttribute("href", `${BASE}?nosystem=1`);
    expect(screen.getByRole("link", { name: "Hide Slack" })).toBeInTheDocument();
  });
});


describe("ActivityFilters, member variant, date range", () => {
  const withRange = { ...parseFeedFilters({ from: "2026-11-03", to: "2026-11-10", noslack: "1" }, MEMBER_DEFAULTS, NOW), memberId: filters.memberId };

  beforeEach(() => push.mockClear());

  it.each([
    ["an admin", false],
    ["a community manager", true],
  ])("offers %s the presets, All time and a From/To form", (_who, limited) => {
    render(<ActivityFilters variant="member" limited={limited} filters={filters} basePath={BASE} />);
    expect(screen.getByRole("link", { name: "90d" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: "All time" })).toHaveAttribute("href", `${BASE}?days=all`);
    expect(screen.getByLabelText("From")).toBeInTheDocument();
    expect(screen.getByLabelText("To")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  it("marks All time as the active preset, and no day preset", () => {
    render(<ActivityFilters variant="member" filters={{ ...filters, days: 0 }} basePath={BASE} />);
    expect(screen.getByRole("link", { name: "All time" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: "90d" })).not.toHaveAttribute("aria-current");
  });

  it("shows a custom range in the pickers, with no preset active, and a preset link drops the range", () => {
    render(<ActivityFilters variant="member" filters={withRange} basePath={BASE} />);
    expect(screen.getByLabelText("From")).toHaveValue("2026-11-03");
    expect(screen.getByLabelText("To")).toHaveValue("2026-11-10");
    for (const name of ["24h", "7d", "30d", "90d", "1y", "All time"]) {
      expect(screen.getByRole("link", { name })).not.toHaveAttribute("aria-current");
    }
    expect(screen.getByRole("link", { name: "30d" })).toHaveAttribute("href", `${BASE}?noslack=1&days=30`);
    expect(screen.getByRole("link", { name: "All time" })).toHaveAttribute("href", `${BASE}?noslack=1&days=all`);
  });

  it("keeps the range when another filter changes, so the toggles carry it", () => {
    render(<ActivityFilters variant="member" filters={withRange} basePath={BASE} />);
    expect(screen.getByRole("link", { name: "Hide system" })).toHaveAttribute("href", `${BASE}?nosystem=1&noslack=1&from=2026-11-03&to=2026-11-10`);
  });

  it("applies the chosen days to the URL without a page, so the list starts on page 1", () => {
    render(<ActivityFilters variant="member" filters={filters} basePath={BASE} />);
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-11-03" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-11-10" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(push).toHaveBeenCalledWith(`${BASE}?from=2026-11-03&to=2026-11-10`);
  });

  it("will not apply a From after the To", () => {
    render(<ActivityFilters variant="member" filters={filters} basePath={BASE} />);
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-11-10" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-11-03" } });
    expect(screen.getByRole("alert")).toHaveTextContent("From is after To");
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    fireEvent.submit(screen.getByRole("form", { name: "Custom date range" }));
    expect(push).not.toHaveBeenCalled();
  });

  it("applies a From alone as From to today", () => {
    render(<ActivityFilters variant="member" filters={filters} basePath={BASE} />);
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-11-03" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0]).toMatch(new RegExp(`^${BASE}\\?from=2026-11-03&to=\\d{4}-\\d{2}-\\d{2}$`));
  });
});
