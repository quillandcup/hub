// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ActivityFeedTable from "@/app/(admin)/admin/activity/ActivityFeedTable";
import { MEMBER_DEFAULTS, type ActivityFeedRow } from "@/lib/activity-feed";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
const nav = vi.hoisted(() => ({ push: vi.fn(), query: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn() }),
  usePathname: () => "/admin/members/mbr_AAAAAAAAAAA1/activity",
  useSearchParams: () => new URLSearchParams(nav.query),
}));

const emailRow = (over: Partial<ActivityFeedRow> = {}): ActivityFeedRow => ({
  event_id: "e1",
  kind: "activity",
  occurred_at: "2097-01-01T10:00:00Z",
  is_audit: false,
  actor_user_id: null,
  actor_kind: "system",
  actor_label: null,
  member_id: "mbr_AAAAAAAAAAA1",
  member_name: "Ada Example",
  acting_as_member_id: null,
  acting_as_member_name: null,
  event_type: "email_opened",
  entity_type: null,
  entity_id: null,
  title: "Opened: Ready for Writing?",
  description: null,
  source: "resend",
  data: { resend_url: "https://resend.com/emails/em_1", email_id: "em_1" },
  ...over,
});

const renderTable = (rows: ActivityFeedRow[]) =>
  render(<ActivityFeedTable rows={rows} total={rows.length} page={1} pageSize={50} filters={MEMBER_DEFAULTS as never} hideAbout />);

describe("ActivityFeedTable email rows", () => {
  it("opens to a link to the email at Resend, even when the row has no description", async () => {
    renderTable([emailRow()]);

    await userEvent.click(screen.getByText(/Opened: Ready for Writing\?|opened/i));
    const link = screen.getByRole("link", { name: "Read this email at Resend" });
    expect(link).toHaveAttribute("href", "https://resend.com/emails/em_1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("shows the description beside the link", async () => {
    renderTable([emailRow({ event_type: "email_clicked", title: "Clicked a link in: Hi", description: "https://hub.example.com/a" })]);

    await userEvent.click(screen.getByText(/Clicked a link in/));
    expect(screen.getByText("https://hub.example.com/a")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Read this email at Resend" })).toBeInTheDocument();
  });

  it("offers no link for an address that is not Resend's, and nothing to open without a description", () => {
    renderTable([emailRow({ data: { resend_url: "https://evil.example.com/emails/em_1" } })]);

    expect(screen.queryByRole("link", { name: "Read this email at Resend" })).not.toBeInTheDocument();
    expect(document.querySelector("details")).toBeNull();
  });
});

describe("ActivityFeedTable audit details", () => {
  it("shows names instead of ids, linked, and hides the row id", async () => {
    renderTable([
      emailRow({
        kind: "audit",
        is_audit: true,
        event_type: "insert",
        entity_type: "calendar_feed_item",
        title: null,
        description: null,
        source: null,
        data: {
          id: { old: null, new: "cfi_AAAAAAAAAAA1" },
          member_id: { old: null, new: "mbr_AAAAAAAAAAA1" },
        },
        refs: { mbr_AAAAAAAAAAA1: { label: "Ada Example", href: "/admin/members/mbr_AAAAAAAAAAA1" } },
      }),
    ]);

    await userEvent.click(screen.getByText(/added calendar item/));
    expect(screen.getByRole("link", { name: "Ada Example" })).toHaveAttribute("href", "/admin/members/mbr_AAAAAAAAAAA1");
    expect(screen.queryByText("cfi_AAAAAAAAAAA1")).not.toBeInTheDocument();
    expect(screen.getByText("member")).toBeInTheDocument();
  });
});

describe("ActivityFeedTable note rows", () => {
  const note = emailRow({
    event_id: "note:mnote_AAAAAAAAAAA1",
    kind: "note",
    actor_kind: "staff",
    actor_user_id: "00000000-0000-4000-8000-000000000001",
    actor_label: "Ania Example",
    event_type: "note",
    title: "Note",
    description: "Sent an Instagram DM\nNo reply yet",
    source: "member_admin_notes",
    data: { note_id: "mnote_AAAAAAAAAAA1", edited_at: null },
  });

  it("shows the note's text in the row without opening anything, between other rows", () => {
    renderTable([emailRow(), note]);
    expect(screen.getByText(/Sent an Instagram DM/)).toBeInTheDocument();
    expect(screen.getByText(/No reply yet/)).toBeInTheDocument();
    expect(screen.getByText("added a note")).toBeInTheDocument();
    expect(screen.getByText("Ania Example")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("gives the note Edit and Delete only where the member page passes controls", () => {
    render(
      <ActivityFeedTable
        rows={[note]}
        total={1}
        page={1}
        pageSize={50}
        filters={MEMBER_DEFAULTS as never}
        hideAbout
        noteControls={{ memberId: "mbr_AAAAAAAAAAA1", currentUserId: "someone-else", editMinutes: 15 }}
      />,
    );
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });
});

describe("ActivityFeedTable source links", () => {
  it("links a check-in to its prickle, beside the sentence and without opening anything", () => {
    renderTable([emailRow({ source: "prickle_checkins", event_type: "prickle_checkin", title: "Checked in", entity_type: "prickle", entity_id: "prkl_AAAAAAAAAAA1", data: null })]);
    expect(screen.getByRole("link", { name: /Open the prickle/ })).toHaveAttribute("href", "/admin/prickles/prkl_AAAAAAAAAAA1");
  });

  it("links a feedback entry to that member's feedback, and keeps the link outside the opened detail", () => {
    renderTable([emailRow({ source: "feedback", event_type: "feedback_submitted", title: "Sent feedback: bug", entity_type: "feedback", entity_id: "b9f3a6c2-0000-4000-8000-000000000001", description: "More", data: null })]);
    expect(screen.getByRole("link", { name: /See their feedback/ })).toHaveAttribute("href", "/admin/feedback?member=mbr_AAAAAAAAAAA1");
  });

  it("shows no source link on a row without a page", () => {
    renderTable([emailRow({ source: "slack", event_type: "slack_message", title: "Posted", data: null })]);
    expect(screen.queryByRole("link", { name: /→/ })).toBeNull();
  });
});

describe("ActivityFeedTable, limited (a community manager)", () => {
  const staffRow = emailRow({ actor_kind: "staff", actor_user_id: "00000000-0000-4000-8000-000000000001", actor_label: "Ania Example", title: "Sent a message", source: "outreach", event_type: "outreach_touch" });
  const renderLimited = (rows: ActivityFeedRow[], limited: boolean) =>
    render(<ActivityFeedTable rows={rows} total={rows.length} page={1} pageSize={50} filters={MEMBER_DEFAULTS as never} hideAbout limited={limited} />);

  it("names the actor without linking to the central log, which she may not open", () => {
    const { unmount } = renderLimited([staffRow], false);
    expect(screen.getByRole("link", { name: "Ania Example" }).getAttribute("href")).toContain("/admin/activity");
    unmount();
    renderLimited([staffRow], true);
    expect(screen.getByText("Ania Example")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Ania Example" })).toBeNull();
  });

  it("keeps a link to a page she may open (a prickle) and drops one to a page she may not (the feedback list)", () => {
    renderLimited(
      [
        emailRow({ event_id: "p1", source: "prickle_checkins", event_type: "prickle_checkin", title: "Checked in", entity_type: "prickle", entity_id: "prkl_AAAAAAAAAAA1", data: null }),
        emailRow({ event_id: "f1", source: "feedback", event_type: "feedback_submitted", title: "Sent feedback", data: null }),
      ],
      true
    );
    expect(screen.getByRole("link", { name: /Open the prickle/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /See their feedback/ })).toBeNull();
  });

  it("shows an admin the feedback link as before", () => {
    renderLimited([emailRow({ event_id: "f1", source: "feedback", event_type: "feedback_submitted", title: "Sent feedback", data: null })], false);
    expect(screen.getByRole("link", { name: /See their feedback/ })).toBeInTheDocument();
  });
});


describe("ActivityFeedTable paging, with a date range", () => {
  const PATH = "/admin/members/mbr_AAAAAAAAAAA1/activity";
  const renderPaged = (page: number) =>
    render(<ActivityFeedTable rows={[emailRow()]} total={120} page={page} pageSize={50} filters={MEMBER_DEFAULTS as never} hideAbout />);

  it("keeps the range and the other filters in the link when going to the next page, and back to page 1 without a page", async () => {
    nav.push.mockClear();
    nav.query = "from=2026-11-03&to=2026-11-10&noslack=1";
    const { unmount } = renderPaged(1);
    await userEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(nav.push).toHaveBeenLastCalledWith(`${PATH}?from=2026-11-03&to=2026-11-10&noslack=1&page=2`);
    unmount();

    nav.query = "from=2026-11-03&to=2026-11-10&noslack=1&page=2";
    renderPaged(2);
    await userEvent.click(screen.getByRole("button", { name: /Prev/ }));
    expect(nav.push).toHaveBeenLastCalledWith(`${PATH}?from=2026-11-03&to=2026-11-10&noslack=1`);
    nav.query = "";
  });
});
