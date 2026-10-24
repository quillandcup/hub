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
vi.mock("@/components/RecordHistoryButton", () => ({ default: () => null }));

import OutreachPage from "@/app/(admin)/admin/outreach/page";

const ROLES: Record<string, string> = { [ADMIN_USER.id]: "admin", [MEMBER_USER.id]: "member" };
const userProfiles = (q: FakeQuery) => {
  const id = q.calls.find((c) => c.method === "eq" && c.args[0] === "id")?.args[1] as string;
  return { data: ROLES[id] ? [{ role: ROLES[id] }] : [] };
};

beforeEach(() => {
  resetServerPageMocks();
});

describe("/admin/outreach", () => {
  it("shows the empty state when no leads carry the tag", async () => {
    signInAs(ADMIN_USER, null);
    useFakeSupabase({ user_profiles: userProfiles, members: { data: [] }, outreach_leads: { data: [] } });
    await renderServerPage(OutreachPage, {});

    expect(screen.getByRole("heading", { name: /Outreach/ })).toBeInTheDocument();
    expect(screen.getByText(/yet\./)).toBeInTheDocument();
  });

  it("sends a member to /no-access", async () => {
    signInAs(MEMBER_USER, null);
    useFakeSupabase({ user_profiles: userProfiles });
    await expectRedirect(OutreachPage, {}, "/no-access");
  });
});
