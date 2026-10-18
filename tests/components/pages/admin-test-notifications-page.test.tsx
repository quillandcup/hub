// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
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
vi.mock("@/app/(admin)/admin/notifications/TestNotifications", () => ({ default: () => <div data-testid="grid" /> }));

import TestNotificationsPage from "@/app/(admin)/admin/notifications/page";

const ROLES: Record<string, string> = { [ADMIN_USER.id]: "admin", [MEMBER_USER.id]: "member" };
const userProfiles = (q: FakeQuery) => {
  const id = q.calls.find((c) => c.method === "eq" && c.args[0] === "id")?.args[1] as string;
  return { data: ROLES[id] ? [{ role: ROLES[id] }] : [] };
};

beforeEach(() => {
  resetServerPageMocks();
  useFakeSupabase({ user_profiles: userProfiles });
});

describe("/admin/notifications", () => {
  it("shows the grid to an admin", async () => {
    signInAs(ADMIN_USER, null);
    await renderServerPage(TestNotificationsPage, {});

    expect(screen.getByRole("heading", { name: "Test Notifications" })).toBeInTheDocument();
    expect(screen.getByTestId("grid")).toBeInTheDocument();
  });

  it("sends a member to /no-access", async () => {
    signInAs(MEMBER_USER, null);
    await expectRedirect(TestNotificationsPage, {}, "/no-access");
  });
});
