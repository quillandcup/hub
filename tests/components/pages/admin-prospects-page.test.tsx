// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { ADMIN_USER, MEMBER_USER, expectRedirect, renderServerPage, resetServerPageMocks, signInAs, useFakeSupabase, type FakeQuery } from "@/tests/helpers/server-page";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/app/(admin)/admin/outreach/prospects/actions", () => ({ importProspects: vi.fn(), reviewProspect: vi.fn() }));

import ProspectsPage from "@/app/(admin)/admin/outreach/prospects/page";

const ROLES: Record<string, string> = { [ADMIN_USER.id]: "admin", [MEMBER_USER.id]: "member" };
const userProfiles = (q: FakeQuery) => {
  const id = q.calls.find((c) => c.method === "eq" && c.args[0] === "id")?.args[1] as string;
  return { data: ROLES[id] ? [{ role: ROLES[id] }] : [] };
};

beforeEach(() => resetServerPageMocks());

describe("/admin/outreach/prospects", () => {
  it("lists prospects for an admin", async () => {
    signInAs(ADMIN_USER, null);
    useFakeSupabase({
      user_profiles: userProfiles,
      outreach_prospects: { data: [{ id: "prsp_AAAAAAAAAAA1", platform: "instagram", handle: "ada.example", source: "paste", source_note: null, bio: "writer", follower_count: null, external_url: null, reject_reason: null, ai_assessment: null, reviewed_at: null, hashtags: [], fit_reasons: [], fit_score: 50, status: "new", created_at: "2097-01-01T00:00:00Z" }] },
    });
    await renderServerPage(ProspectsPage, {});

    expect(screen.getByRole("heading", { name: /Prospects/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "@ada.example" })).toBeInTheDocument();
  });

  it("sends a signed-out visitor to login and a member to no-access", async () => {
    signInAs(null);
    useFakeSupabase({ user_profiles: userProfiles });
    await expectRedirect(ProspectsPage, {}, "/login");

    signInAs(MEMBER_USER, null);
    await expectRedirect(ProspectsPage, {}, "/no-access");
  });
});
