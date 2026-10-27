// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import CalendarEventsClient from "@/app/(admin)/admin/events/calendar/CalendarEventsClient";
import type { CalendarListItem } from "@/lib/calendar-events";

const item = (id: string, extra: Partial<CalendarListItem> = {}): CalendarListItem => ({
  id,
  summary: `Item ${id}`,
  location: null,
  start_time: "2097-05-02T23:00:00Z",
  end_time: "2097-05-03T00:00:00Z",
  prickleType: null,
  needsType: false,
  event: null,
  ...extra,
});

let requests: string[];
let respond: (url: string, init?: RequestInit) => { ok?: boolean; body: unknown };

beforeEach(() => {
  requests = [];
  respond = () => ({ body: { items: [], hasMore: false } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push(`${init?.method ?? "GET"} ${url}`);
      const r = respond(url, init);
      return { ok: r.ok ?? true, json: async () => r.body } as Response;
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CalendarEventsClient", () => {
  it("says what each calendar item is and offers to show the ones not in Events", async () => {
    respond = () => ({
      body: {
        items: [
          item("a", { prickleType: "Sprint Prickle", location: "Zoom" }),
          item("b", { needsType: true }),
          item("c", { event: { id: "evt_AAAAAAAAAAA1", slug: "c", hidden: false } }),
          item("d", { summary: null }),
        ],
        hasMore: false,
      },
    });
    render(<CalendarEventsClient />);

    expect(await screen.findByText("Prickle · Sprint Prickle")).toBeInTheDocument();
    expect(screen.getByText(/· Zoom/)).toBeInTheDocument();
    expect(screen.getByText("Needs a prickle type")).toBeInTheDocument();
    expect(screen.getAllByText("Not a prickle")).toHaveLength(2);
    expect(screen.getByText("Untitled")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Show in Events" })).toHaveLength(3);
    expect(screen.getByRole("link", { name: "In Events · Edit" })).toHaveAttribute("href", "/admin/events/evt_AAAAAAAAAAA1");
  });

  it("shows an item in Events and then links to its event", async () => {
    respond = (url, init) =>
      init?.method === "POST"
        ? { body: { event: { id: "evt_AAAAAAAAAAA2", slug: "item-a", hidden: false } } }
        : { body: { items: [item("a")], hasMore: false } };
    render(<CalendarEventsClient />);

    await userEvent.click(await screen.findByRole("button", { name: "Show in Events" }));

    expect(await screen.findByRole("link", { name: "In Events · Edit" })).toHaveAttribute("href", "/admin/events/evt_AAAAAAAAAAA2");
    expect(requests).toContain("POST /api/admin/events/calendar");
  });

  it("shows a failure to add an item, and a failure to load", async () => {
    respond = (url, init) => (init?.method === "POST" ? { ok: false, body: { error: "Calendar event not found" } } : { body: { items: [item("a")], hasMore: false } });
    render(<CalendarEventsClient />);
    await userEvent.click(await screen.findByRole("button", { name: "Show in Events" }));
    expect(await screen.findByText("Calendar event not found")).toBeInTheDocument();
    cleanup();

    respond = () => ({ ok: false, body: { error: "Could not load" } });
    render(<CalendarEventsClient />);
    expect(await screen.findByText("Could not load")).toBeInTheDocument();
  });

  it("filters to what's shown in Events, searches, and pages", async () => {
    respond = (url) => ({ body: { items: [item(url.includes("offset=50") ? "later" : "first")], hasMore: !url.includes("offset=50") } });
    render(<CalendarEventsClient />);
    expect(await screen.findByText("Item first")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Later →" }));
    expect(await screen.findByText("Item later")).toBeInTheDocument();
    expect(requests.at(-1)).toContain("offset=50");

    await userEvent.click(screen.getByRole("button", { name: "← Earlier" }));
    await screen.findByText("Item first");

    await userEvent.click(screen.getByRole("button", { name: "Shown in Events" }));
    await waitFor(() => expect(requests.at(-1)).toContain("filter=in_events"));

    await userEvent.type(screen.getByLabelText("Search calendar items"), "fair");
    await waitFor(() => expect(requests.at(-1)).toContain("q=fair"));
  });

  it("says when there are none", async () => {
    render(<CalendarEventsClient />);
    expect(await screen.findByText("No calendar items.")).toBeInTheDocument();
  });
});
