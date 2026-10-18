// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import {
  ADMIN_USER,
  MEMBER_USER,
  expectRedirect,
  renderServerPage,
  resetServerPageMocks,
  signInAs,
  useFakeSupabase,
  type FakeQuery,
} from "@/tests/helpers/server-page";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/app/(admin)/admin/prickle-join/actions", () => ({ savePrickleJoin: vi.fn(), removeScheduledPrickleJoin: vi.fn() }));

import PrickleJoinPage from "@/app/(admin)/admin/prickle-join/page";

const ROLES: Record<string, string> = { [ADMIN_USER.id]: "admin", [MEMBER_USER.id]: "member" };
const userProfiles = (q: FakeQuery) => {
  const id = q.calls.find((c) => c.method === "eq" && c.args[0] === "id")?.args[1] as string;
  return { data: ROLES[id] ? [{ role: ROLES[id] }] : [] };
};

const row = (id: string, effective_from: string, passcode: string) => ({
  id,
  join_url: `https://zoom.example.test/j/${id}`,
  meeting_id: `id-${id}`,
  passcode,
  effective_from,
  created_at: effective_from,
});

beforeEach(() => {
  resetServerPageMocks();
  // Pins "now" so which rows are in effect doesn't depend on the day the suite runs.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-12-01T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("/admin/prickle-join", () => {
  it("shows the current link, the history as ranges, and a Remove for a scheduled change only", async () => {
    signInAs(ADMIN_USER, null);
    useFakeSupabase({
      user_profiles: userProfiles,
      prickle_join_settings: {
        // Newest first, as the loader orders them: one scheduled far out, then two in effect.
        data: [row("3", "2099-01-01T05:00:00Z", "future"), row("2", "2026-11-01T05:00:00Z", "november"), row("1", "2026-10-01T04:00:00Z", "october")],
      },
    });
    await renderServerPage(PrickleJoinPage, {});

    expect(screen.getByRole("heading", { name: "Prickle Zoom Link" })).toBeInTheDocument();
    expect(screen.getByLabelText("One-click join link")).toHaveValue("https://zoom.example.test/j/2");
    expect(screen.getByLabelText("Meeting ID")).toHaveValue("id-2");
    expect(screen.getByLabelText("Passcode")).toHaveValue("november");
    expect(screen.getByText(/meeting ID id-3, passcode future \(scheduled\)/)).toBeInTheDocument();
    expect(screen.getByText(/passcode october/).textContent).toMatch(/Oct 1, 2026.* to Nov 1, 2026/);
    expect(screen.getByText(/passcode future/).textContent).toContain("onward");
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(1);
  });

  it("shows an empty form before any link is saved", async () => {
    signInAs(ADMIN_USER, null);
    useFakeSupabase({ user_profiles: userProfiles });
    await renderServerPage(PrickleJoinPage, {});

    expect(screen.getByLabelText("One-click join link")).toHaveValue("");
    expect(screen.queryByText("History")).not.toBeInTheDocument();
  });

  it("sends a member to /no-access", async () => {
    signInAs(MEMBER_USER, null);
    useFakeSupabase({ user_profiles: userProfiles });
    await expectRedirect(PrickleJoinPage, {}, "/no-access");
  });
});
