// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import ShowInEvents from "@/app/(admin)/admin/prickles/[id]/ShowInEvents";

const CALENDAR_ID = "00000000-0000-4000-8000-00000000000a";
let calls: { url: string; body: unknown }[];
let respond: (url: string) => { ok?: boolean; body: unknown };

beforeEach(() => {
  calls = [];
  respond = () => ({ body: {} });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const r = respond(url);
      return { ok: r.ok ?? true, json: async () => r.body } as Response;
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ShowInEvents", () => {
  it("shows a calendar prickle in Events and then offers to edit or hide the event", async () => {
    respond = () => ({ body: { event: { id: "evt_AAAAAAAAAAA1", slug: "x", hidden: false } } });
    render(<ShowInEvents calendarEventId={CALENDAR_ID} initial={null} />);
    expect(screen.getByText("Not shown in Events.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Show in Events" }));

    expect(await screen.findByText("Shown in Events.")).toBeInTheDocument();
    expect(calls[0]).toEqual({ url: "/api/admin/events/calendar", body: { calendarEventId: CALENDAR_ID } });
    expect(screen.getByRole("link", { name: "Edit the event" })).toHaveAttribute("href", "/admin/events/evt_AAAAAAAAAAA1");
    expect(screen.getByRole("button", { name: "Hide from members" })).toBeInTheDocument();
  });

  it("hides a shown event and shows it again", async () => {
    render(<ShowInEvents calendarEventId={CALENDAR_ID} initial={{ id: "evt_AAAAAAAAAAA1", hidden: false }} />);

    await userEvent.click(screen.getByRole("button", { name: "Hide from members" }));
    expect(await screen.findByText("Hidden from members.")).toBeInTheDocument();
    expect(calls[0]).toEqual({ url: "/api/admin/events/evt_AAAAAAAAAAA1/visibility", body: { hidden: true } });

    await userEvent.click(screen.getByRole("button", { name: "Show to members" }));
    expect(await screen.findByText("Shown in Events.")).toBeInTheDocument();
    expect(calls[1].body).toEqual({ hidden: false });
  });

  it("starts from a hidden event, and says how to use the Google Calendar tag", () => {
    render(<ShowInEvents calendarEventId={CALENDAR_ID} initial={{ id: "evt_AAAAAAAAAAA1", hidden: true }} />);

    expect(screen.getByText("Hidden from members.")).toBeInTheDocument();
    expect(screen.getByText(/add #event to the event's description in Google Calendar/)).toBeInTheDocument();
  });

  it("shows why it couldn't add or change", async () => {
    respond = () => ({ ok: false, body: { error: "Calendar event not found" } });
    render(<ShowInEvents calendarEventId={CALENDAR_ID} initial={null} />);
    await userEvent.click(screen.getByRole("button", { name: "Show in Events" }));
    expect(await screen.findByText("Calendar event not found")).toBeInTheDocument();
    cleanup();

    respond = () => ({ ok: false, body: {} });
    render(<ShowInEvents calendarEventId={CALENDAR_ID} initial={{ id: "evt_AAAAAAAAAAA1", hidden: false }} />);
    await userEvent.click(screen.getByRole("button", { name: "Hide from members" }));
    expect(await screen.findByText("That didn't work")).toBeInTheDocument();
  });
});
