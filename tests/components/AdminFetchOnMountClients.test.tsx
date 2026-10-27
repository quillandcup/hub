// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, cleanup, within, fireEvent } from "@testing-library/react";

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

  it("MemberOverridesClient sorts the Member column by display name", async () => {
    const override = (id: string, name: string, display_name: string) => ({
      member_id: id, created_at: "2026-01-01", override_type: "gift", reason: "r", starts_at: "2026-01-01",
      expires_at: null, notes: null, id: `ovr_${id}`,
      member: { id, name, display_name, email: `${id}@example.test` },
    });
    mockFetch({
      "/api/member-overrides": {
        body: { overrides: [override("m1", "Aaa Example", "Zed E"), override("m2", "Zzz Example", "Abe E")] },
      },
      "/api/members": { body: { members: [] } },
    });
    render(<MemberOverridesClient />);
    await screen.findByText("Zed E");
    fireEvent.click(screen.getByText("Member"));
    const rows = screen.getAllByRole("row").slice(1).map((r) => r.textContent ?? "");
    expect(rows[0]).toContain("Abe E");
    expect(rows[1]).toContain("Zed E");
  });

  it("ReconciliationClient sorts every Member column by display name and shows the legal name only when it differs", async () => {
    const zed = { member_name: "Aaa Example", member_display_name: "Zed E" };
    const abe = { member_name: "Zzz Example", member_display_name: "Abe E" };
    const same = { member_name: "Mid Example", member_display_name: null };
    const rec = (id: string, n: object) => ({
      member_id: id, member_email: `${id}@example.test`, expected_kajabi_state: "active",
      actual_kajabi_state: "inactive", stripe_state: "none", override_id: null, override_type: null,
      override_reason: null, override_notes: null, override_starts_at: null, override_expires_at: null,
      is_on_hiatus: false, has_discrepancy: true, ...n,
    });
    mockFetch({
      "/api/analyze/subscription-reconciliation": {
        body: {
          summary: { total_members: 3, active_in_stripe: 0, paused_in_stripe: 0, active_in_kajabi: 0, total_overrides: 0, discrepancies: 3 },
          members: [rec("m1", zed), rec("m2", abe), rec("m3", same)],
          metadata: { kajabi_import_timestamp: null, stripe_import_timestamp: null },
        },
      },
      "/api/analyze/slack-reconciliation": { body: { total_in_slack: 0, members_in_slack: [] } },
      "/api/analyze/stripe-orphans": { body: { total_active_subscriptions: 0, orphans: [] } },
      "/api/analyze/kajabi-grants": {
        body: {
          grants: [
            { kajabi_purchase_id: "g1", offer_name: "O", amount_in_cents: 0, created_at: null, member_id: "m1", member_email: "m1@example.test", member_status: "active", ...zed },
            { kajabi_purchase_id: "g2", offer_name: "O", amount_in_cents: 0, created_at: null, member_id: "m2", member_email: "m2@example.test", member_status: "active", ...abe },
          ],
        },
      },
      "/api/analyze/zoom-access": {
        body: {
          matched_inactive: [
            { member_id: "m1", member_status: "cancelled", prickle_count: 1, ...zed },
            { member_id: "m2", member_status: "cancelled", prickle_count: 1, ...abe },
          ],
        },
      },
    });
    render(<ReconciliationClient />);
    await screen.findByText("Mid Example");
    // Legal name line appears only when it differs from the display name.
    expect(screen.getAllByText("Mid Example")).toHaveLength(1);
    expect(screen.getAllByText("Aaa Example").length).toBeGreaterThan(0);

    const headers = screen.getAllByText("Member");
    expect(headers).toHaveLength(3);
    for (const header of headers) {
      fireEvent.click(header);
      const table = header.closest("table") as HTMLElement;
      const text = within(table).getAllByRole("row").slice(1).map((r) => r.textContent ?? "");
      const order = text.map((t) => (t.includes("Abe E") ? "Abe" : t.includes("Zed E") ? "Zed" : "Mid")).filter((n) => n !== "Mid");
      expect(order).toEqual(["Abe", "Zed"]);
    }
  });
});
