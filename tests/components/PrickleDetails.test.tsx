// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PrickleDetails from "@/components/PrickleDetails";

const prickle = {
  id: "p1",
  start_time: "2026-10-20T15:00:00Z",
  end_time: "2026-10-20T16:00:00Z",
  source: "calendar",
  host: { id: "h1", name: "Jenn Parker" },
  prickle_types: { name: "Progress Prickle", description: null },
};

const record = {
  id: "a1",
  member_id: "m1",
  join_time: "2026-10-20T15:02:00Z",
  leave_time: "2026-10-20T16:00:00Z",
  members: { id: "m1", name: "Fern Quillsby" },
};

const renderDetails = (props: Partial<React.ComponentProps<typeof PrickleDetails>> = {}) =>
  render(
    <PrickleDetails
      prickle={prickle as never}
      attendanceRecords={[]}
      hostMissing={false}
      hostLate={false}
      userTimezonePreference="America/New_York"
      memberBasePath="/members"
      showMemberEmails={false}
      {...props}
    />
  );

describe("PrickleDetails attendees", () => {
  it("invites you to check back for a prickle that hasn't started, rather than saying nobody came", () => {
    renderDetails({ hasStarted: false });
    expect(screen.getByRole("heading", { name: "Who's coming" })).toBeInTheDocument();
    expect(screen.getByText("Stay tuned to see who attends!")).toBeInTheDocument();
    expect(screen.getByText("Hasn't started yet")).toBeInTheDocument();
    expect(screen.queryByText(/No attendance records/)).not.toBeInTheDocument();
    expect(screen.queryByText(/0 attendees/)).not.toBeInTheDocument();
  });

  it("still says so when a prickle that has started has no attendance", () => {
    renderDetails({ hasStarted: true });
    expect(screen.getByRole("heading", { name: "Attendees (0)" })).toBeInTheDocument();
    expect(screen.getByText("No attendance records for this Prickle")).toBeInTheDocument();
  });

  it("lists attendees as before", () => {
    renderDetails({ hasStarted: true, attendanceRecords: [record] });
    expect(screen.getByRole("heading", { name: "Attendees (1)" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Fern Quillsby" })).toHaveAttribute("href", "/members/m1");
  });
});
