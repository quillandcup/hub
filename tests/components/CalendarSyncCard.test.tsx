// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { calendarFeedUrls } from "@/lib/calendar-feed";

const regenerate = vi.fn();
const removeItem = vi.fn();
const refresh = vi.fn();
vi.mock("@/app/(member)/my-prickles/calendar-feed-actions", () => ({
  regenerateMyCalendarFeedToken: () => regenerate(),
  removeMyCalendarItem: (id: string) => removeItem(id),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import CalendarSyncCard from "@/app/(member)/my-prickles/CalendarSyncCard";

const ORIGIN = "https://hub.quillandcup.com";
const URLS = calendarFeedUrls(ORIGIN, "0123456789abcdef0123456789abcdef");
const NEW_URLS = calendarFeedUrls(ORIGIN, "fedcba9876543210fedcba9876543210");

beforeEach(() => {
  regenerate.mockReset();
  removeItem.mockReset();
  refresh.mockReset();
  localStorage.clear();
});

describe("CalendarSyncCard", () => {
  it("links to Google, Apple and Outlook with the member's feed", () => {
    render(<CalendarSyncCard initialUrls={URLS} />);
    expect(screen.getByRole("link", { name: "Google Calendar" })).toHaveAttribute("href", URLS.google);
    expect(screen.getByRole("link", { name: "Apple Calendar" })).toHaveAttribute("href", URLS.webcal);
    expect(screen.getByRole("link", { name: "Outlook" })).toHaveAttribute("href", URLS.outlook);
  });

  it("explains setup step by step, naming the calendar that will appear", async () => {
    const user = userEvent.setup();
    render(<CalendarSyncCard initialUrls={URLS} />);
    await user.click(screen.getByText("How does it work?"));
    const steps = screen.getAllByRole("listitem");
    expect(steps).toHaveLength(3);
    expect(steps[1]).toHaveTextContent("“My Prickles · Hedgie Hub”");
    expect(steps[2]).toHaveTextContent("Other calendars → + → From URL");
  });

  it("says hosted and committed prickles are included automatically, and how to add others", () => {
    render(<CalendarSyncCard initialUrls={URLS} />);
    expect(screen.getByText(/Prickles you host and prickles you.ve committed to show up automatically/)).toBeInTheDocument();
    expect(screen.getByText(/in All Prickles or on the event.s page/)).toBeInTheDocument();
  });

  it("lists added items and removes one", async () => {
    const user = userEvent.setup();
    removeItem.mockResolvedValue({ ok: true });
    render(
      <CalendarSyncCard
        initialUrls={URLS}
        items={[
          { id: "i1", kind: "slot", label: "Educational Prickle · every Tuesday · 7:00 PM EDT", slotKey: "k" },
          { id: "i2", kind: "event", label: "Fall Retreat · Oct 9 – Oct 11", eventId: "e1" },
        ]}
      />
    );
    expect(screen.getByRole("heading", { name: "Also added to your calendar" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove Fall Retreat · Oct 9 – Oct 11 from your calendar" }));
    expect(removeItem).toHaveBeenCalledWith("i2");
    expect(refresh).toHaveBeenCalled();
  });

  it("copies the https feed link", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    render(<CalendarSyncCard initialUrls={URLS} />);
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith(URLS.https);
    expect(await screen.findByRole("button", { name: "Copied!" })).toBeInTheDocument();
  });

  it("asks before generating a new link, then switches every button to it", async () => {
    const user = userEvent.setup();
    regenerate.mockResolvedValue({ urls: NEW_URLS });
    render(<CalendarSyncCard initialUrls={URLS} />);

    await user.click(screen.getByRole("button", { name: "Generate new link" }));
    expect(regenerate).not.toHaveBeenCalled();
    expect(screen.getByText(/will stop updating/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Generate new link" }));
    expect(regenerate).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("status")).toHaveTextContent("New link ready");
    expect(screen.getByRole("link", { name: "Google Calendar" })).toHaveAttribute("href", NEW_URLS.google);
    expect(screen.getByRole("link", { name: "Apple Calendar" })).toHaveAttribute("href", NEW_URLS.webcal);
  });

  it("keeps the current link and shows the error if regenerating fails", async () => {
    const user = userEvent.setup();
    regenerate.mockResolvedValue({ error: "Couldn't generate a new link. Please try again." });
    render(<CalendarSyncCard initialUrls={URLS} />);
    await user.click(screen.getByRole("button", { name: "Generate new link" }));
    await user.click(screen.getByRole("button", { name: "Generate new link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't generate a new link");
    expect(screen.getByRole("link", { name: "Google Calendar" })).toHaveAttribute("href", URLS.google);
  });

  it("collapses, and stays collapsed on the next visit", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<CalendarSyncCard initialUrls={URLS} />);
    await user.click(screen.getByRole("button", { name: "Hide calendar sync options" }));
    expect(screen.queryByRole("link", { name: "Google Calendar" })).not.toBeInTheDocument();
    unmount();

    render(<CalendarSyncCard initialUrls={URLS} />);
    expect(screen.queryByRole("link", { name: "Google Calendar" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show calendar sync options" }));
    expect(screen.getByRole("link", { name: "Google Calendar" })).toBeInTheDocument();
  });
});
