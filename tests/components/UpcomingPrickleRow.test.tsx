// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import UpcomingPrickleRow, { CHECKIN_SOON_MS } from "@/components/UpcomingPrickleRow";
import type { UpcomingPrickle } from "@/lib/upcoming-prickles";

const NOW = Date.parse("2026-10-05T15:00:00Z");
const prickle = (startsInMs: number) =>
  ({
    id: "p1",
    typeName: "Progress Prickle",
    hostName: "Jenn Parker",
    startTime: new Date(NOW + startsInMs).toISOString(),
  }) as UpcomingPrickle;

const renderRow = (startsInMs: number, checkin = null as React.ComponentProps<typeof UpcomingPrickleRow>["checkin"]) =>
  render(<UpcomingPrickleRow prickle={prickle(startsInMs)} reasons={[]} timeZone="UTC" checkin={checkin} now={NOW} />);

describe("UpcomingPrickleRow check-in pill", () => {
  it("offers Check in → for a prickle starting soon, linking to the check-in modal", () => {
    renderRow(30 * 60 * 1000);
    expect(screen.getByRole("link", { name: "Check in →" })).toHaveAttribute("href", "/my-prickles/history?checkin=p1");
    expect(screen.queryByRole("link", { name: /Check out/ })).not.toBeInTheDocument();
  });

  it("has no pill for a prickle further out", () => {
    renderRow(CHECKIN_SOON_MS + 60_000);
    expect(screen.queryByRole("link", { name: /Check in/ })).not.toBeInTheDocument();
  });

  it("shows a finished check-in as done", () => {
    renderRow(10 * 60 * 1000, { feelingsBefore: ["calm"], need: "gentle", sessionRating: null, feelingsAfter: [] });
    expect(screen.getByRole("link", { name: "Checked in ✓" })).toBeInTheDocument();
  });

  it("still links the prickle itself", () => {
    renderRow(30 * 60 * 1000);
    expect(screen.getByRole("link", { name: /Progress Prickle/ })).toHaveAttribute("href", "/prickles/p1");
  });
});
