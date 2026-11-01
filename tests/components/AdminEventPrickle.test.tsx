// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import EventDetailClient from "@/app/(admin)/admin/events/[slug]/EventDetailClient";

const EVENT = {
  id: "evt_AAAAAAAAAAA1",
  slug: "free-writing-hour",
  title: "Free Writing Hour",
  event_type: "other",
  location: "Zoom",
  starts_at: "2097-05-01",
  ends_at: "2097-05-01",
  focus: null,
  description: "From the prickle",
  agenda: null,
  results: null,
  google_photos_album_url: null,
  announced_publicly: true,
  guests_allowed: true,
  registration: "none",
  capacity: null,
  selection: "first_come",
  speakers: "Ada Example",
  host_name: "Jenny",
  host_id: "mbr_JENNY0000001",
  start_time: "2097-05-01T04:00:00Z",
  end_time: "2097-05-02T04:00:00Z",
  deleted_at: null as string | null,
};

function serve(hubSession: boolean) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ event: EVENT, prickleId: "prkl_AAAAAAAAAAA1", hubSession, photos: [], badgeType: null, attendees: [] }) }) as Response),
  );
}

beforeEach(() => {
  serve(false);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("admin event on a calendar prickle", () => {
  it("has no notice sending you to the prickle, only a secondary link", async () => {
    render(<EventDetailClient eventId={EVENT.id} />);

    expect(await screen.findByRole("link", { name: "View prickle" })).toHaveAttribute("href", "/admin/prickles/prkl_AAAAAAAAAAA1");
    expect(screen.queryByText(/stands on a calendar prickle/)).not.toBeInTheDocument();
  });

  it("edits the title, description, host, speaker and location here, with the dates read-only", async () => {
    render(<EventDetailClient eventId={EVENT.id} />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));

    expect(screen.getByLabelText("Title")).toHaveValue("Free Writing Hour");
    expect(screen.getByLabelText("Location")).toHaveValue("Zoom");
    expect(screen.getByLabelText("Description")).toHaveValue("From the prickle");
    expect(screen.getByText("Jenny")).toBeInTheDocument();
    expect(screen.getByLabelText("Guest speakers")).toBeEnabled();
    expect(screen.queryByLabelText("Starts")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Guests allowed")).toBeEnabled();
  });

  it("marks what was set by hand, from the server", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ event: EVENT, prickleId: "prkl_AAAAAAAAAAA1", hubSession: false, overridden: { title: true, description: false, guestSpeaker: false, location: false }, photos: [], badgeType: null, attendees: [] }) }) as Response),
    );
    render(<EventDetailClient eventId={EVENT.id} />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));

    expect(screen.getByText("(edited)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Follow the calendar again" })).toBeInTheDocument();
  });

  it("is an ordinary event, with everything editable and no note, when it was made in the Hub", async () => {
    serve(true);
    render(<EventDetailClient eventId={EVENT.id} />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));

    expect(screen.queryByText(/stands on a calendar prickle/)).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Free Writing Hour")).toBeEnabled();
    expect(screen.getByLabelText("Guest speakers")).toBeEnabled();
    expect(screen.getByLabelText("Host")).toHaveValue("Jenny");
  });
});

describe("saving from the admin event page", () => {
  function servePatch(patch: { ok: boolean; body: unknown }) {
    const calls: { method: string; body?: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        calls.push({ method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (method === "PATCH") return { ok: patch.ok, json: async () => patch.body } as Response;
        return { ok: true, json: async () => ({ event: EVENT, prickleId: "prkl_AAAAAAAAAAA1", hubSession: true, photos: [], badgeType: null, attendees: [] }) } as Response;
      }),
    );
    return calls;
  }

  it("sends the form, shows what the server kept, and closes", async () => {
    const calls = servePatch({ ok: true, body: { event: { ...EVENT, location: "Room 9" } } });
    render(<EventDetailClient eventId={EVENT.id} />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    await userEvent.clear(screen.getByLabelText("Location"));
    await userEvent.type(screen.getByLabelText("Location"), "Room 9");

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Room 9")).toBeInTheDocument();
    expect(calls.find((c) => c.method === "PATCH")!.body).toMatchObject({ location: "Room 9" });
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("stays open and says why when the server refuses", async () => {
    servePatch({ ok: false, body: { error: "event_type must be one of: workshop" } });
    render(<EventDetailClient eventId={EVENT.id} />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("event_type must be one of: workshop")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("says so when the server gives no reason", async () => {
    servePatch({ ok: false, body: {} });
    render(<EventDetailClient eventId={EVENT.id} />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Failed to save event")).toBeInTheDocument();
  });
});

