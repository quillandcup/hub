// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import PrickleDetails from "@/components/PrickleDetails";
import type { PrickleDetail } from "@/lib/domain/prickle";

const prickle: PrickleDetail = {
  id: "p1",
  typeId: "t1",
  hostId: "h1",
  title: null,
  description: null,
  startTime: "2026-10-20T15:00:00Z",
  endTime: "2026-10-20T16:00:00Z",
  source: "calendar",
  calendarEventId: null,
  host: { id: "h1", name: "Jenn Parker", displayName: null },
  type: { id: "t1", name: "Progress Prickle", normalizedName: "progress", description: null, purpose: "writing", requiresHost: true, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false },
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
      prickle={prickle}
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
  it("shows the guest speaker next to the host, and nothing when there is none", () => {
    const { unmount } = renderDetails({ prickle: { ...prickle, guestSpeaker: "Ellen Example" } });
    expect(screen.getByText("Guest speaker:")).toBeInTheDocument();
    expect(screen.getByText("Ellen Example")).toBeInTheDocument();
    unmount();
    renderDetails();
    expect(screen.queryByText("Guest speaker:")).not.toBeInTheDocument();
  });

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

describe("PrickleDetails who's coming", () => {
  const entry = (over: Partial<import("@/lib/prickle-roster").RosterEntry> = {}) => ({
    memberId: "m1",
    name: "Fern Quillsby",
    reason: "committed" as const,
    isYou: false,
    hiddenFromOthers: false,
    ...over,
  });

  it("lists the host, who committed, and who added it to their calendar, linking to their profiles", () => {
    renderDetails({
      hasStarted: false,
      roster: {
        entries: [
          entry({ memberId: "h1", name: "Zoe Host", reason: "host" }),
          entry(),
          entry({ memberId: "m2", name: "Bramble Hedge", reason: "calendar" }),
        ],
        total: 3,
      },
    });
    expect(screen.getByRole("heading", { name: "Who's coming" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Fern Quillsby" })).toHaveAttribute("href", "/members/m1");
    // An icon per row (the same ones the prickle lists use), not words, with the meaning on hover and for screen readers.
    const row = (name: string) => screen.getByRole("link", { name }).closest("li")!;
    expect(within(row("Zoe Host")).getByRole("img", { name: "Hosting" })).toHaveTextContent("🎤");
    expect(within(row("Fern Quillsby")).getByRole("img", { name: "Committed" })).toHaveTextContent("📌");
    expect(within(row("Bramble Hedge")).getByRole("img", { name: "On their calendar" })).toHaveTextContent("📅");
    // One short legend, instead of repeating the words on every row.
    expect(screen.getByText("🎤 Hosting · 📌 Committed · 📅 On their calendar")).toBeInTheDocument();
    expect(screen.getByText(/It's not a sign-up/)).toBeInTheDocument();
    expect(screen.queryByText("Stay tuned to see who attends!")).not.toBeInTheDocument();
  });

  it("points at where to opt out", () => {
    renderDetails({ hasStarted: false, roster: { entries: [entry()], total: 1 } });
    expect(screen.getByRole("link", { name: /Change it in your profile settings/ })).toHaveAttribute(
      "href",
      "/settings/profile"
    );
  });

  it("marks you, and says when you're hidden from others", () => {
    renderDetails({
      hasStarted: false,
      roster: { entries: [entry({ isYou: true }), entry({ memberId: "m2", name: "Bo", isYou: true, hiddenFromOthers: true })], total: 2 },
    });
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText("You (hidden from others)")).toBeInTheDocument();
  });

  it("says how many more there are when the list is cut off", () => {
    renderDetails({ hasStarted: false, roster: { entries: [entry()], total: 41 } });
    expect(screen.getByText("and 40 more")).toBeInTheDocument();
  });

  it("keeps the stay-tuned message when nobody's listed yet", () => {
    renderDetails({ hasStarted: false, roster: { entries: [], total: 0 } });
    expect(screen.getByText("Stay tuned to see who attends!")).toBeInTheDocument();
  });

  it("links to the admin member pages for admins", () => {
    renderDetails({ hasStarted: false, memberBasePath: "/admin/members", roster: { entries: [entry()], total: 1 } });
    expect(screen.getByRole("link", { name: "Fern Quillsby" })).toHaveAttribute("href", "/admin/members/m1");
  });

  it("shows attendance, not the roster, once the prickle has started", () => {
    renderDetails({ hasStarted: true, roster: { entries: [entry()], total: 1 } });
    expect(screen.queryByText("Committed")).not.toBeInTheDocument();
    expect(screen.getByText("No attendance records for this Prickle")).toBeInTheDocument();
  });
});

describe("PrickleDetails summary", () => {
  it("shows the title or a default, the description, type, host and source", () => {
    const { rerender } = renderDetails();
    expect(screen.getByRole("heading", { name: "Prickle Details" })).toBeInTheDocument();
    expect(screen.getByText("Progress Prickle")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Jenn Parker" })).toHaveAttribute("href", "/members/h1");
    expect(screen.getByText("Google Calendar")).toBeInTheDocument();

    rerender(
      <PrickleDetails
        prickle={{
          ...prickle,
          title: "Tiny Things Workshop",
          description: "Bring a tiny idea.",
          source: "zoom",
          type: { ...prickle.type!, description: "Timed writing in company." },
        }}
        attendanceRecords={[]}
        hostMissing={false}
        hostLate={false}
        userTimezonePreference="America/New_York"
        memberBasePath="/members"
        showMemberEmails={false}
      />,
    );
    expect(screen.getByRole("heading", { name: "Tiny Things Workshop" })).toBeInTheDocument();
    expect(screen.getByText("Bring a tiny idea.")).toBeInTheDocument();
    expect(screen.getByText("Timed writing in company.")).toBeInTheDocument();
    expect(screen.getByText("Pop-Up Prickle (Zoom)")).toBeInTheDocument();
  });

  describe("display names", () => {
    const named = { ...prickle, host: { id: "h1", name: "Laura May Best", displayName: "Bestie" } };
    const bestAttendee = { ...record, members: { id: "m1", name: "Laura May Best", display_name: "Bestie" } };

    it("shows the host and attendees by display name to members", () => {
      renderDetails({ prickle: named, attendanceRecords: [bestAttendee, { ...record, id: "a2", members: { id: "m2", name: "Ann Example", display_name: null } }] });
      expect(screen.getAllByRole("link", { name: "Bestie" })).toHaveLength(2);
      expect(screen.queryByText("Laura May Best")).not.toBeInTheDocument();
    });

    it("keeps the legal name for admins", () => {
      renderDetails({ prickle: named, attendanceRecords: [bestAttendee], memberBasePath: "/admin/members", showMemberEmails: true });
      expect(screen.getAllByRole("link", { name: "Laura May Best" })).toHaveLength(2);
      expect(screen.queryByText("Bestie")).not.toBeInTheDocument();
    });

    it("sorts attendees by the name shown", async () => {
      const { default: userEvent } = await import("@testing-library/user-event");
      // Legal names sort Zed first, display names sort Amy first.
      renderDetails({
        attendanceRecords: [
          { ...record, id: "a1", members: { id: "m1", name: "Abe Example", display_name: "Zed" } },
          { ...record, id: "a2", members: { id: "m2", name: "Zoe Example", display_name: "Amy" } },
        ],
      });
      await userEvent.click(screen.getByRole("columnheader", { name: /member/i }));
      const links = screen.getAllByRole("link").filter((l) => ["Amy", "Zed"].includes(l.textContent ?? ""));
      expect(links.map((l) => l.textContent)).toEqual(["Amy", "Zed"]);
    });
  });
});
