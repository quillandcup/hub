// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import EventsClient from "@/app/(admin)/admin/events/EventsClient";
import EventDetailClient from "@/app/(admin)/admin/events/[id]/EventDetailClient";
import ImportPhotosClient from "@/app/(admin)/admin/events/[id]/import-photos/ImportPhotosClient";
import MemberOverridesClient from "@/app/(admin)/admin/member-overrides/MemberOverridesClient";
import ProgramsClient from "@/app/(admin)/admin/programs/ProgramsClient";
import ProgramDetailClient from "@/app/(admin)/admin/programs/[id]/ProgramDetailClient";
import ReconciliationClient from "@/app/(admin)/admin/reconciliation/ReconciliationClient";

type Route = { ok?: boolean; body: unknown };

function mockFetch(routes: Record<string, Route>) {
  const fn = vi.fn(async (url: string) => {
    const route = routes[url] ?? { ok: true, body: {} };
    return { ok: route.ok ?? true, json: async () => route.body } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("admin pages that fetch on mount", () => {
  it("EventsClient loads events and leaves the loading state", async () => {
    const fetchFn = mockFetch({ "/api/admin/events": { body: { events: [] } } });
    render(<EventsClient />);
    expect(await screen.findByText("No events found.")).toBeInTheDocument();
    expect(fetchFn).toHaveBeenCalledWith("/api/admin/events");
  });

  it("EventDetailClient requests its event and shows a failure", async () => {
    const fetchFn = mockFetch({
      "/api/admin/events/evt_1": { ok: false, body: { error: "Event gone" } },
    });
    render(<EventDetailClient eventId="evt_1" />);
    expect(await screen.findByText("Event gone")).toBeInTheDocument();
    expect(fetchFn).toHaveBeenCalledWith("/api/admin/events/evt_1");
    expect(fetchFn).toHaveBeenCalledWith("/api/members");
  });

  it("MemberOverridesClient loads overrides and the member list", async () => {
    const fetchFn = mockFetch({
      "/api/member-overrides": { body: { overrides: [] } },
      "/api/members": { body: { members: [] } },
    });
    render(<MemberOverridesClient />);
    await waitFor(() => expect(screen.queryByText("Loading...")).not.toBeInTheDocument());
    expect(fetchFn).toHaveBeenCalledWith("/api/member-overrides");
    expect(fetchFn).toHaveBeenCalledWith("/api/members");
  });

  it("ProgramsClient loads programs", async () => {
    const fetchFn = mockFetch({ "/api/admin/programs": { body: { programs: [] } } });
    render(<ProgramsClient />);
    await waitFor(() => expect(screen.queryByText("Loading...")).not.toBeInTheDocument());
    expect(fetchFn).toHaveBeenCalledWith("/api/admin/programs");
  });

  it("ProgramDetailClient fills the offer selection from the loaded program", async () => {
    mockFetch({
      "/api/admin/programs/prg_1": {
        body: {
          program: { id: "prg_1", name: "Program One", kajabi_offer_names: ["Offer Alpha"] },
          cohorts: [],
          leakage: [],
        },
      },
      "/api/admin/kajabi-offers": { body: { names: ["Offer Alpha", "Offer Beta"] } },
    });
    render(<ProgramDetailClient programId="prg_1" />);
    expect(await screen.findByText("Offer Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Offer Beta")).not.toBeInTheDocument();
  });

  it("ReconciliationClient fetches every source on mount and shows a failure", async () => {
    const fetchFn = mockFetch({
      "/api/analyze/subscription-reconciliation": { ok: false, body: { error: "Reconciliation down" } },
      "/api/analyze/slack-reconciliation": { ok: false, body: { error: "x" } },
      "/api/analyze/stripe-orphans": { ok: false, body: { error: "x" } },
      "/api/analyze/kajabi-grants": { ok: false, body: { error: "x" } },
      "/api/analyze/zoom-access": { ok: false, body: { error: "x" } },
    });
    render(<ReconciliationClient />);
    expect(await screen.findByText("Reconciliation down")).toBeInTheDocument();
    for (const path of ["slack-reconciliation", "stripe-orphans", "kajabi-grants", "zoom-access"]) {
      expect(fetchFn).toHaveBeenCalledWith(`/api/analyze/${path}`);
    }
  });

  it("ImportPhotosClient polls until the picker is done, then imports", async () => {
    const fetchFn = mockFetch({
      "/api/admin/events/evt_1/photos/import/status": { body: { mediaItemsSet: true } },
      "/api/admin/events/evt_1/photos/import/commit": { body: { total: 3, imported: 3, skipped: 0, remaining: 0 } },
    });
    render(<ImportPhotosClient eventId="evt_1" pickerUri="https://picker.example.com/x" />);
    expect(await screen.findByText(/3 of 3 photos imported/)).toBeInTheDocument();
    expect(fetchFn).toHaveBeenCalledWith("/api/admin/events/evt_1/photos/import/status");
  });

  it("ImportPhotosClient shows a status failure", async () => {
    mockFetch({
      "/api/admin/events/evt_1/photos/import/status": { ok: false, body: { error: "Picker unavailable" } },
    });
    render(<ImportPhotosClient eventId="evt_1" pickerUri="https://picker.example.com/x" />);
    expect(await screen.findByText("Picker unavailable")).toBeInTheDocument();
  });
});
