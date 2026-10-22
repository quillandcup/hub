// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ADMIN_USER, renderServerPage, resetServerPageMocks, signInAs, useFakeSupabase, type FakeSupabase } from "@/tests/helpers/server-page";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
const requireAdminPage = vi.fn(async () => undefined);
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: () => requireAdminPage() }));
// The graph itself is a client component with its own tests; here it shows what the page hands it.
vi.mock("@/app/(admin)/admin/members/network/NetworkGraph", () => ({
  default: ({ nodes, edges }: { nodes: unknown[]; edges: unknown[] }) => <pre data-testid="graph">{JSON.stringify({ nodes: nodes.length, edges })}</pre>,
}));

import MemberNetworkPage from "@/app/(admin)/admin/members/network/page";

const MEMBERS = [
  { id: "a", name: "Fern Quillsby", email: "fern@example.test", status: "active" },
  { id: "b", name: "Gale Prickleton", email: "gale@example.test", status: "active" },
  { id: "c", name: "Hazel Burrows", email: "hazel@example.test", status: "active" },
];
// Fern and Gale shared two prickles; Hazel one with Gale.
const ATTENDANCE = [
  { member_id: "a", prickle_id: "p1" },
  { member_id: "b", prickle_id: "p1" },
  { member_id: "a", prickle_id: "p2" },
  { member_id: "b", prickle_id: "p2" },
  { member_id: "b", prickle_id: "p3" },
  { member_id: "c", prickle_id: "p3" },
];
const pair = (x: string, y: string, kind: string, visibility: string, n: number | string) => ({ member_x: x, member_y: y, kind, visibility, n });

// What the fake client answers, read when the page asks (so each test sets it before rendering).
let members: unknown[] = MEMBERS;
let pairRows: unknown[] = [];
let fake: FakeSupabase;
const renderPage = (searchParams: Record<string, string> = {}, pairs: unknown[] = []) => {
  pairRows = pairs;
  return renderServerPage(MemberNetworkPage, { searchParams: Promise.resolve(searchParams) });
};
const graph = () => JSON.parse(screen.getByTestId("graph").textContent!) as { nodes: number; edges: Record<string, unknown>[] };
const rpcArgs = () => fake.queries.find((q) => q.table === "rpc:member_interaction_pairs")?.calls.find((c) => c.method === "args")?.args[0] as { p_since: string; p_include_private: boolean } | undefined;

beforeEach(() => {
  resetServerPageMocks();
  signInAs(ADMIN_USER);
  requireAdminPage.mockClear();
  members = MEMBERS;
  pairRows = [];
  fake = useFakeSupabase({
    members: () => ({ data: members }),
    prickle_attendance: { data: ATTENDANCE },
    "rpc:member_interaction_pairs": () => ({ data: pairRows }),
  });
});

describe("admin member network page", () => {
  it("is for admins", async () => {
    await renderPage();
    expect(requireAdminPage).toHaveBeenCalledTimes(1);
  });

  it("starts with prickles and public chat over the last 90 days, merged into the edges", async () => {
    await renderPage({}, [pair("a", "b", "thread_reply", "public", 2), pair("b", "c", "mention", "public", 1)]);

    expect(rpcArgs()?.p_include_private).toBe(false);
    const days = (Date.now() - Date.parse(rpcArgs()!.p_since)) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(89.9);
    expect(days).toBeLessThan(90.1);

    const { nodes, edges } = graph();
    expect(nodes).toBe(3);
    expect(edges).toEqual([
      expect.objectContaining({ source: "a", target: "b", prickles: 2, chat: 2, weight: 4, chatByKind: { thread_reply: 2 } }),
      expect.objectContaining({ source: "b", target: "c", prickles: 1, chat: 1, weight: 2 }),
    ]);
  });

  it("includes private channels and DMs only when asked for, and says what that means", async () => {
    await renderPage({ chat: "all", days: "30" }, [pair("a", "b", "dm", "private", 3)]);

    expect(rpcArgs()?.p_include_private).toBe(true);
    expect(screen.getByText(/Includes private channels and direct messages/)).toBeInTheDocument();
    expect(graph().edges[0]).toMatchObject({ chatPrivate: 3, chatByKind: { dm: 3 } });
  });

  it("leaves chat out entirely when it is off: nothing is read and there is no window to choose", async () => {
    await renderPage({ chat: "off" }, [pair("a", "b", "dm", "private", 3)]);

    expect(rpcArgs()).toBeUndefined();
    expect(screen.queryByText("Last:")).not.toBeInTheDocument();
    expect(graph().edges.every((e) => e.chat === 0)).toBe(true);
  });

  it("shows the options as links that keep each other's choice, marking the current ones", async () => {
    await renderPage({ chat: "all", days: "365" });
    const nav = within(screen.getByRole("navigation", { name: "Network options" }));

    expect(nav.getByRole("link", { name: "Everything" })).toHaveAttribute("aria-current", "true");
    expect(nav.getByRole("link", { name: "Off" })).toHaveAttribute("href", "/admin/members/network?chat=off&days=365");
    expect(nav.getByRole("link", { name: "1 year" })).toHaveAttribute("aria-current", "true");
    expect(nav.getByRole("link", { name: "30 days" })).toHaveAttribute("href", "/admin/members/network?chat=all&days=30");
  });

  it("falls back to the defaults for options it doesn't know", async () => {
    await renderPage({ chat: "bogus", days: "7" });
    const nav = within(screen.getByRole("navigation", { name: "Network options" }));
    expect(nav.getByRole("link", { name: "Public channels" })).toHaveAttribute("aria-current", "true");
    expect(nav.getByRole("link", { name: "90 days" })).toHaveAttribute("aria-current", "true");
  });

  it("reads every page of pairs past the 1000-row limit, and takes counts that arrive as strings", async () => {
    const many = Array.from({ length: 2300 }, () => pair("a", "b", "mention", "public", 1));
    many.push(pair("a", "c", "mention", "public", "4"));
    await renderPage({}, many);

    const edges = graph().edges;
    expect(edges.find((e) => e.target === "b")).toMatchObject({ chat: 2300 });
    expect(edges.find((e) => e.target === "c")).toMatchObject({ chat: 4 });
  });

  it("says so when there are no active members", async () => {
    members = [];
    await renderPage();
    expect(screen.getByText("No active members found.")).toBeInTheDocument();
  });
});
