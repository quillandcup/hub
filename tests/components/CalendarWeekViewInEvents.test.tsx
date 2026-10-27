// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SecondaryTimezoneProvider } from "@/components/SecondaryTimezone";
import CalendarWeekView, { type Prickle } from "@/components/CalendarWeekView";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
}));

const prickle = (id: string, inEvents?: Prickle["in_events"]): Prickle => ({
  id,
  host: "Host",
  start_time: "2026-06-02T14:00:00Z",
  end_time: "2026-06-02T15:00:00Z",
  prickle_type: `Type ${id}`,
  attendance_count: 0,
  in_events: inEvents,
});

function renderView(prickles: Prickle[]) {
  return render(
    <SecondaryTimezoneProvider zone={null}>
      <CalendarWeekView prickles={prickles} weekStartDate={{ year: 2026, month: 5, day: 1 }} userTimezonePreference="UTC" mode="admin" />
    </SecondaryTimezoneProvider>,
  );
}

describe("CalendarWeekView: prickles in Events", () => {
  it("marks a prickle shown in Events with a star, and leaves the others plain", () => {
    renderView([prickle("shown", "shown"), prickle("hiddenOne", "hidden"), prickle("plain")]);

    expect(screen.getAllByTitle("In Events")).toHaveLength(1);
    expect(screen.getByText("Type shown").querySelector("[title='In Events']")).not.toBeNull();
    expect(screen.getByText("Type hiddenOne").querySelector("[title='In Events']")).toBeNull();
    expect(screen.getByText("Type plain").querySelector("[title='In Events']")).toBeNull();
  });

  it.each([
    ["shown" as const, "In Events"],
    ["hidden" as const, "Removed from Events"],
  ])("says in the tooltip of a prickle that is %s: %s", (state, label) => {
    renderView([prickle("p", state)]);

    fireEvent.mouseEnter(screen.getByText("Type p").closest("div[class*='absolute']")!);

    expect(screen.getByText(label, { selector: "div" })).toBeInTheDocument();
  });

  it("says nothing about Events in the tooltip of a prickle with no event", () => {
    renderView([prickle("p")]);

    fireEvent.mouseEnter(screen.getByText("Type p").closest("div[class*='absolute']")!);

    expect(screen.getByText("Host: Host")).toBeInTheDocument();
    expect(screen.queryByText("In Events", { selector: "div" })).not.toBeInTheDocument();
    expect(screen.queryByText("Removed from Events")).not.toBeInTheDocument();
  });
});
