// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PRIVACY_ENTITY_TYPES, type ActivityFeedRow } from "@/lib/activity-feed";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));

const rpc = vi.fn();
const tables: Record<string, unknown[]> = {};
// Minimal chainable stand-in: every builder method returns itself and awaiting it yields the table's rows.
function builder(table: string) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "order", "range", "in", "eq"]) b[m] = () => b;
  b.maybeSingle = async () => ({ data: (tables[table] ?? [])[0] ?? null, error: null });
  b.then = (resolve: (v: unknown) => unknown) => resolve({ data: tables[table] ?? [], error: null });
  return b;
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc, from: builder }) }));
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: vi.fn(async () => ({ id: "admin", email: "a@example.test" })) }));

const { default: ActivityLogPage } = await import("@/app/(admin)/admin/activity/page");
const { requireAdminPage } = await import("@/lib/admin-auth");

const MEMBER_ID = "00000000-0000-4000-a000-0000000000b1";

const base: ActivityFeedRow = {
  event_id: "audit:1",
  kind: "audit",
  occurred_at: "2026-10-05T12:00:00Z",
  is_audit: true,
  actor_user_id: "00000000-0000-4000-a000-0000000000a1",
  actor_kind: "staff",
  actor_label: "Bramble Admin",
  member_id: MEMBER_ID,
  member_name: "Fern Quillsby",
  acting_as_member_id: null,
  acting_as_member_name: null,
  event_type: "update",
  entity_type: "member",
  entity_id: MEMBER_ID,
  title: null,
  description: null,
  source: "audit_log",
  data: { status: { old: "lead", new: "active" } },
};

async function renderPage(params: Record<string, string> = {}) {
  render(await ActivityLogPage({ searchParams: Promise.resolve(params) }));
}

/** count_activity_feed and get_activity_feed answers for one page of `rows`. */
function feed(rows: ActivityFeedRow[], total = rows.length) {
  rpc.mockImplementation(async (name: string) =>
    name === "count_activity_feed" ? { data: total, error: null } : { data: rows, error: null }
  );
}

beforeEach(() => {
  rpc.mockReset();
  tables.members = [{ id: MEMBER_ID, name: "Fern Quillsby", email: "fern@example.test", user_id: null }];
  tables.user_profiles = [{ id: "00000000-0000-4000-a000-0000000000a1", email: "bramble@example.test", role: "admin" }];
  vi.mocked(requireAdminPage).mockClear();
});

describe("/admin/activity", () => {
  it("requires admin and shows an audit row with its field delta and member link", async () => {
    feed([base]);
    await renderPage();

    expect(requireAdminPage).toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("count_activity_feed", expect.objectContaining({ p_audit_only: true }));
    expect(screen.getByText("Bramble Admin")).toBeInTheDocument();
    expect(screen.getByText("changed member — status")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Fern Quillsby" })[0]).toHaveAttribute(
      "href",
      `/admin/members/${MEMBER_ID}`
    );
    expect(screen.getByText("lead")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
  });

  it("passes the hide-system toggle to the feed", async () => {
    feed([base]);
    await renderPage({ nosystem: "1" });
    expect(rpc).toHaveBeenCalledWith("count_activity_feed", expect.objectContaining({ p_hide_system: true }));
    expect(screen.getByRole("link", { name: "Hide system" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows both people when an admin acted in sudo", async () => {
    feed([{ ...base, acting_as_member_id: MEMBER_ID, acting_as_member_name: "Fern Quillsby" }]);
    await renderPage({ sudo: "1" });

    expect(rpc).toHaveBeenCalledWith("count_activity_feed", expect.objectContaining({ p_sudo_only: true }));
    expect(screen.getByText("Bramble Admin (as Fern Quillsby)")).toBeInTheDocument();
    expect(screen.getByText("sudo")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Viewed as member" })).toHaveAttribute("aria-pressed", "true");
  });

  it("Everything view shows kind filters and a page-visit trail", async () => {
    feed([
      {
        ...base,
        event_id: "session:1",
        kind: "session",
        is_audit: false,
        actor_kind: "member",
        actor_label: "Fern Quillsby",
        event_type: "visit",
        entity_type: null,
        entity_id: null,
        data: { pages: ["/dashboard", "/my-prickles"] },
      },
    ]);
    await renderPage({ view: "all" });

    expect(rpc).toHaveBeenCalledWith("count_activity_feed", expect.objectContaining({ p_audit_only: false }));
    expect(screen.getByRole("link", { name: "Page visits" })).toBeInTheDocument();
    expect(screen.getByText("visited 2 pages (Dashboard ×1, My Prickles ×1)")).toBeInTheDocument();
    expect(screen.getByText("/my-prickles")).toBeInTheDocument();
  });

  it("offers the shared Actor and Member pickers and hides kind filters in the audit view", async () => {
    feed([], 0);
    await renderPage();
    expect(screen.getByPlaceholderText("Search staff...")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search members...")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Page visits" })).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing in this window/)).toBeInTheDocument();
  });

  it("Privacy view asks only for privacy entity types and reads restriction changes as sentences", async () => {
    feed([
      {
        ...base,
        event_id: "audit:9",
        event_type: "insert",
        entity_type: "restricted_slack_channel",
        entity_id: "C123",
        description: "inner-circle",
        data: { channel_id: { old: null, new: "C123" } },
      },
    ]);
    await renderPage({ view: "privacy" });

    expect(rpc).toHaveBeenCalledWith(
      "count_activity_feed",
      expect.objectContaining({ p_audit_only: false, p_entity_types: [...PRIVACY_ENTITY_TYPES] })
    );
    expect(screen.getByText("restricted staff access to messages in #inner-circle")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/admin/activity?view=privacy");
    expect(screen.queryByRole("link", { name: "Page visits" })).not.toBeInTheDocument();
  });

  it("uses the standard table pager with the total and requested page", async () => {
    feed([base], 120);
    await renderPage({ page: "2", pageSize: "50" });

    expect(rpc).toHaveBeenCalledWith("get_activity_feed", expect.objectContaining({ p_offset: 50, p_limit: 50 }));
    expect(screen.getByText(/of 120 events/)).toBeInTheDocument();
  });
});
