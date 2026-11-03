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
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/admin/members/mbr_AAAAAAAAAAA1/activity",
  useSearchParams: () => new URLSearchParams(),
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
