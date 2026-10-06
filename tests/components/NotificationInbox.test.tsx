// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

const markRead = vi.fn();
const markUnread = vi.fn();
vi.mock("@/components/InAppNotifications", () => ({
  useInAppNotifications: () => ({ error: null, markRead, markUnread, markAllRead: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/notifications",
  useSearchParams: () => new URLSearchParams(),
}));

const { default: NotificationInbox } = await import("@/app/(member)/notifications/NotificationInbox");
import type { InAppNotification, InboxPage } from "@/lib/channels/in-app";

const base: InAppNotification = {
  id: "n1",
  kind: "prickle_checkin",
  text: "First",
  url: null,
  createdAt: "2026-10-05T10:00:00Z",
  read: false,
  banner: false,
};
const ITEMS: InAppNotification[] = [
  base,
  { ...base, id: "n2", text: "Second", read: true },
  { ...base, id: "n3", text: "Third", read: false },
];

async function startEditing(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Edit multiple" }));
}

function renderInbox() {
  const inbox: InboxPage = { items: ITEMS, total: 3, counts: { all: 3, unread: 2 }, page: 1, pageSize: 25 };
  return render(<NotificationInbox inbox={inbox} filter="all" kind={null} />);
}

beforeEach(() => {
  markRead.mockReset().mockResolvedValue(true);
  markUnread.mockReset().mockResolvedValue(true);
});

describe("NotificationInbox", () => {
  it("marks one notification unread from its row, and read again", async () => {
    const user = userEvent.setup();
    renderInbox();
    await user.click(screen.getByRole("button", { name: "Mark unread" }));
    expect(markUnread).toHaveBeenCalledWith(["n2"]);
    expect(screen.getByRole("button", { name: /^All \(3\)/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Unread \(3\)/ })).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Mark read" })[0]);
    expect(markRead).toHaveBeenCalledWith(["n1"]);
  });

  it("hides the checkboxes until Edit multiple, and Done hides them and drops the selection", async () => {
    const user = userEvent.setup();
    renderInbox();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("toolbar", { name: "Bulk actions" })).not.toBeInTheDocument();

    await startEditing(user);
    expect(screen.getAllByRole("checkbox")).toHaveLength(4);
    expect(screen.queryByRole("toolbar", { name: "Bulk actions" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Select: First" }));
    expect(screen.getByRole("toolbar", { name: "Bulk actions" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("toolbar", { name: "Bulk actions" })).not.toBeInTheDocument();
    await startEditing(user);
    expect(screen.getByRole("checkbox", { name: "Select: First" })).not.toBeChecked();
  });

  it("bulk marks only the selected rows that need changing, then clears the selection", async () => {
    const user = userEvent.setup();
    renderInbox();
    await startEditing(user);
    await user.click(screen.getByRole("checkbox", { name: "Select: First" }));
    await user.click(screen.getByRole("checkbox", { name: "Select: Second" }));
    const bar = screen.getByRole("toolbar", { name: "Bulk actions" });
    expect(within(bar).getByText("2 selected")).toBeInTheDocument();

    await user.click(within(bar).getByRole("button", { name: "Mark as read" }));
    expect(markRead).toHaveBeenCalledWith(["n1"]);
    expect(screen.queryByRole("toolbar", { name: "Bulk actions" })).not.toBeInTheDocument();
  });

  it("select all picks every row on the page and Mark as unread applies to the read ones", async () => {
    const user = userEvent.setup();
    renderInbox();
    await startEditing(user);
    await user.click(screen.getByRole("checkbox", { name: "Select all on this page" }));
    expect(within(screen.getByRole("toolbar", { name: "Bulk actions" })).getByText("3 selected")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Mark as unread" }));
    expect(markUnread).toHaveBeenCalledWith(["n2"]);
  });

  it("puts the rows back and keeps the selection when saving fails", async () => {
    markRead.mockResolvedValue(false);
    const user = userEvent.setup();
    renderInbox();
    await startEditing(user);
    await user.click(screen.getByRole("checkbox", { name: "Select: First" }));
    await user.click(screen.getByRole("button", { name: "Mark as read" }));
    expect(screen.getByRole("button", { name: /^Unread \(2\)/ })).toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: "Bulk actions" })).toBeInTheDocument();
  });
});
