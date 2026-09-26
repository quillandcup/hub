// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import MemberHostingCard from "@/app/(member)/members/[id]/MemberHostingCard";
import type { PublicHostingSummary } from "@/lib/hosting-stats";
import type { HostedScheduleSlot } from "@/lib/prickle-schedule";

const TZ = "America/New_York";

const EMPTY: PublicHostingSummary = {
  totalHosted: 0,
  firstHostedAt: null,
  mostRecentHostedAt: null,
  avgAttendance: null,
  typeNames: [],
};

const SUMMARY: PublicHostingSummary = {
  totalHosted: 42,
  firstHostedAt: "2024-03-12T14:00:00.000Z",
  mostRecentHostedAt: "2026-09-22T14:00:00.000Z",
  avgAttendance: 5.6,
  typeNames: ["Progress Prickle", "Sprint"],
};

const SLOT: HostedScheduleSlot = {
  seriesKey: "t1:2-10:00",
  sortKey: "2-10:00",
  dayOfWeek: "Tuesday",
  timeLabel: "10:00 AM EDT",
  typeName: "Progress Prickle",
  nextOccurrenceId: "prickle-123",
  nextOccurrenceStart: "2026-09-29T14:00:00.000Z",
  upcomingCount: 5,
};

describe("MemberHostingCard", () => {
  it("renders nothing for a member who has never hosted and has nothing upcoming", () => {
    const { container } = render(<MemberHostingCard summary={EMPTY} slots={[]} timeZone={TZ} firstName="Pat" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows public hosting stats and types, without punctuality", () => {
    render(<MemberHostingCard summary={SUMMARY} slots={[]} timeZone={TZ} firstName="Pat" />);
    expect(screen.getByText("Hosting")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("prickles hosted")).toBeInTheDocument();
    expect(screen.getByText("Mar 2024")).toBeInTheDocument();
    expect(screen.getByText("~6")).toBeInTheDocument();
    expect(screen.getByText("Sprint")).toBeInTheDocument();
    expect(screen.queryByText(/on-time/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no-show/i)).not.toBeInTheDocument();
    // No schedule section without upcoming slots.
    expect(screen.queryByText(/Join Pat at/)).not.toBeInTheDocument();
  });

  it("lists upcoming slots linking to the next occurrence's prickle page", () => {
    render(<MemberHostingCard summary={SUMMARY} slots={[SLOT]} timeZone={TZ} firstName="Pat" />);
    expect(screen.getByText("Join Pat at")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Tuesdays · 10:00 AM EDT/ });
    expect(link).toHaveAttribute("href", "/prickles/prickle-123");
    expect(link).toHaveTextContent("next Tue, Sep 29");
  });

  it("uses the singular day for a one-off slot", () => {
    render(
      <MemberHostingCard summary={SUMMARY} slots={[{ ...SLOT, upcomingCount: 1 }]} timeZone={TZ} firstName="Pat" />
    );
    expect(screen.getByRole("link", { name: /^Tuesday · 10:00 AM EDT/ })).toBeInTheDocument();
  });

  it("shows the schedule alone for a new host with no hosting history yet", () => {
    render(<MemberHostingCard summary={EMPTY} slots={[SLOT]} timeZone={TZ} firstName="Pat" />);
    expect(screen.getByRole("link", { name: /Tuesdays/ })).toBeInTheDocument();
    expect(screen.queryByText("prickles hosted")).not.toBeInTheDocument();
  });

  it("formats dates in the viewer's timezone", () => {
    render(
      <MemberHostingCard
        summary={{ ...SUMMARY, firstHostedAt: "2024-03-31T23:30:00.000Z" }}
        slots={[]}
        timeZone="Asia/Tokyo"
        firstName="Pat"
      />
    );
    expect(screen.getByText("Apr 2024")).toBeInTheDocument();
  });
});
