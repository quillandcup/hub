// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@/lib/analytics/client", () => ({ track: vi.fn() }));

import EventsClient from "@/app/(admin)/admin/events/EventsClient";

function event(id: string, title: string, starts: string, ends: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    slug: id,
    title,
    event_type: "workshop",
    location: null,
    starts_at: starts,
    ends_at: ends,
    photo_count: 0,
    deleted_at: null,
    ...extra,
  };
}

const EVENTS = [
  event("evt_AAAAAAAAAAA1", "Far future", "2097-12-03", "2097-12-03", { location: "https://us02web.zoom.us/j/123" }),
  event("evt_AAAAAAAAAAA2", "Old retreat", "2020-05-01", "2020-05-03", { location: "Virginia", photo_count: 12 }),
  event("evt_AAAAAAAAAAA3", "Soon", "2096-01-10", "2096-01-10", { location: "—" }),
  event("evt_AAAAAAAAAAA4", "Recent past", "2021-03-01", "2021-03-01"),
];

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (url.startsWith("/api/members") ? { members: [] } : { events: EVENTS }),
    })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("admin events list", () => {
  it("lists upcoming soonest first, then past most recent first", async () => {
    render(<EventsClient />);
    await screen.findByText("Soon");
    const titles = screen.getAllByRole("link").map((a) => a.textContent);
    expect(titles).toEqual(["Soon", "Far future", "Recent past", "Old retreat"]);
  });

  it("shows one date for a single day, a range for several, and hides placeholders", async () => {
    render(<EventsClient />);
    await screen.findByText("Soon");
    expect(screen.queryByText(/12\/3\/2097 – 12\/3\/2097/)).not.toBeInTheDocument();
    expect(screen.getByText("12/3/2097")).toBeInTheDocument();
    expect(screen.getByText("5/1/2020 – 5/3/2020")).toBeInTheDocument();
    expect(screen.getByText("Online")).toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("filters by the search box", async () => {
    render(<EventsClient />);
    await screen.findByText("Soon");
    await userEvent.type(screen.getByLabelText("Search events"), "virginia");
    await waitFor(() => expect(screen.queryByText("Soon")).not.toBeInTheDocument());
    expect(screen.getByText("Old retreat")).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Search events"));
    await userEvent.type(screen.getByLabelText("Search events"), "zzz");
    expect(screen.getByText("No events match your filters.")).toBeInTheDocument();
  });

  it("filters to events overlapping a date range and clears it", async () => {
    render(<EventsClient />);
    await screen.findByText("Soon");
    await userEvent.type(screen.getByLabelText("From"), "2020-05-02");
    await userEvent.type(screen.getByLabelText("To"), "2021-12-31");
    await waitFor(() => expect(screen.queryByText("Soon")).not.toBeInTheDocument());
    expect(screen.getByText("Old retreat")).toBeInTheDocument();
    expect(screen.getByText("Recent past")).toBeInTheDocument();
    expect(screen.queryByText("Far future")).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("Clear dates"));
    expect(screen.getByText("Soon")).toBeInTheDocument();
  });
});
